// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AURAMAXX — a room-scale parimutuel on Monad
/// @notice Round 1 is settled by a price the operator submits. Round 2 is settled by a camera
///         counting lit phone screens, against a threshold this contract computes itself.
///         AURA has no monetary value. Winners are paid in testnet MON at the end.
/// @dev Maths follow auramaxx_paper.pdf exactly: integer only, multiply before divide,
///      empty winning pool refunds, dust to faucetReserve.
contract Auramaxx {
    // --- players first: one MIP-8 storage page holds many of them (page = slot >> 7) ---

    struct Player {
        address addr; // 160
        uint96 profit; // 96  -> one slot; cumulative POSITIVE profit only, this is the score
        bytes32 name;
        uint8 avatar;
        uint32 nonce;
    }

    Player[] public players; // id = index + 1, so id 0 means "not joined"
    mapping(address => uint16) public idOf;

    // --- rounds ---

    uint128 public constant BUDGET = 1000; // AURA credited fresh to every player, every round
    uint8 public constant UP = 0; // also OVER
    uint8 public constant DOWN = 1; // also UNDER
    uint256 public constant TICKS = 11; // 45 s window / ~4 s cooldown
    uint256 public constant THRESHOLD_PCT = 45; // of N * TICKS

    struct Round {
        uint8 kind; // 0 = price, 1 = magenta
        uint8 status; // 0 = open, 1 = frozen, 2 = resolved
        uint8 winner;
        bool hasWinner;
        uint64 freezeAtBlock;
        uint128 poolUp;
        uint128 poolDown;
        uint32 threshold; // kind 1 only, computed at freeze
        uint32 settledCount; // kind 1 only, what the camera saw
    }

    Round[] public rounds;
    mapping(uint256 => uint16[]) private bettorIds;
    mapping(uint256 => mapping(uint16 => uint128)) public stakeOf;
    mapping(uint256 => mapping(uint16 => uint8)) public sideOf;
    mapping(uint256 => uint16) public paidUpTo; // resolveChunk cursor

    address public immutable operator;
    address public relayer;
    mapping(address => bool) public cannotTrade; // the house cannot bet. Three lines, on purpose.
    uint256 public faucetReserve; // rounding dust lands here

    event Joined(uint16 indexed id, address indexed addr, bytes32 name, uint8 avatar);
    event Bet(uint256 indexed roundId, uint16 indexed id, uint8 side, uint128 stake, uint128 total);
    event RoundOpened(uint256 indexed roundId, uint8 kind, uint64 freezeAtBlock);
    event RoundFrozen(uint256 indexed roundId, uint128 poolUp, uint128 poolDown, uint32 threshold);
    event Resolved(uint256 indexed roundId, uint8 winner, uint128 total, uint16 winners, bool refunded);
    event Paid(uint256 indexed roundId, uint16 indexed id, uint128 payout, uint96 profit);
    event MonPaid(uint16 indexed id, address indexed to, uint256 amount);

    error NotOperator();
    error NotRelayer();
    error BadState();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer && msg.sender != operator) revert NotRelayer();
        _;
    }

    constructor(address _relayer) {
        operator = msg.sender;
        relayer = _relayer;
        cannotTrade[msg.sender] = true; // the operator can never bet
        cannotTrade[_relayer] = true;
    }

    receive() external payable {} // funded before the MON payout

    // --- joining -------------------------------------------------------------------------

    function joinBatch(address[] calldata who, bytes32[] calldata names, uint8[] calldata avatars)
        external
        onlyRelayer
    {
        uint256 n = who.length;
        for (uint256 i; i < n;) {
            address a = who[i];
            if (idOf[a] == 0 && !cannotTrade[a]) {
                players.push(Player({addr: a, profit: 0, name: names[i], avatar: avatars[i], nonce: 0}));
                uint16 id = uint16(players.length); // ids start at 1
                idOf[a] = id;
                emit Joined(id, a, names[i], avatars[i]);
            }
            unchecked {
                ++i;
            }
        }
    }

    // --- rounds --------------------------------------------------------------------------

    function openRound(uint8 kind, uint64 freezeAtBlock) external onlyOperator returns (uint256 id) {
        id = rounds.length;
        rounds.push(
            Round({
                kind: kind,
                status: 0,
                winner: 0,
                hasWinner: false,
                freezeAtBlock: freezeAtBlock,
                poolUp: 0,
                poolDown: 0,
                threshold: 0,
                settledCount: 0
            })
        );
        emit RoundOpened(id, kind, freezeAtBlock);
    }

    struct Entry {
        address player;
        uint8 side;
        uint128 stake;
        uint32 nonce;
        bytes sig;
    }

    /// @notice Relays signed bets. A bad entry is SKIPPED, never reverted: one malformed bet
    ///         must not destroy the other nineteen in the same transaction.
    function commitBatch(uint256 roundId, Entry[] calldata entries) external onlyRelayer {
        Round storage r = rounds[roundId];
        if (r.status != 0) revert BadState();
        if (block.number > r.freezeAtBlock) revert BadState();

        uint256 n = entries.length;
        for (uint256 i; i < n;) {
            _applyEntry(roundId, r, entries[i]);
            unchecked {
                ++i;
            }
        }
    }

    function _applyEntry(uint256 roundId, Round storage r, Entry calldata e) private {
        uint16 id = idOf[e.player];
        if (id == 0 || cannotTrade[e.player]) return;
        if (e.side > DOWN || e.stake == 0) return;

        Player storage p = players[id - 1];
        if (e.nonce <= p.nonce) return; // replay
        if (!_verify(roundId, e)) return;

        uint128 already = stakeOf[roundId][id];
        // add-only: once you have a side you cannot move chips to the other one
        if (already > 0 && sideOf[roundId][id] != e.side) return;

        uint128 room = BUDGET - already; // BUDGET is fresh every round
        if (room == 0) return;
        uint128 stake = e.stake > room ? room : e.stake; // clamp, never revert

        p.nonce = e.nonce;
        if (already == 0) {
            bettorIds[roundId].push(id);
            sideOf[roundId][id] = e.side;
        }
        stakeOf[roundId][id] = already + stake;

        if (e.side == UP) r.poolUp += stake;
        else r.poolDown += stake;

        emit Bet(roundId, id, e.side, stake, r.poolUp + r.poolDown);
    }

    function _verify(uint256 roundId, Entry calldata e) private view returns (bool) {
        bytes32 h = keccak256(
            abi.encodePacked("AURAMAXX", block.chainid, address(this), roundId, e.player, e.side, e.stake, e.nonce)
        );
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        if (e.sig.length != 65) return false;
        bytes32 rr;
        bytes32 ss;
        uint8 v;
        bytes calldata sig = e.sig;
        assembly {
            rr := calldataload(sig.offset)
            ss := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(signed, v, rr, ss) == e.player;
    }

    /// @notice Locks betting and, for a magenta round, computes the threshold from the number of
    ///         players who actually bet. The operator never chooses it.
    function freeze(uint256 roundId) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.status != 0) revert BadState();
        r.status = 1;
        if (r.kind == 1) {
            r.threshold = uint32((bettorIds[roundId].length * TICKS * THRESHOLD_PCT) / 100);
        }
        emit RoundFrozen(roundId, r.poolUp, r.poolDown, r.threshold);
    }

    function resolveByPrice(uint256 roundId, int256 openPrice, int256 closePrice) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.status != 1 || r.kind != 0) revert BadState();
        r.winner = closePrice > openPrice ? UP : DOWN; // a tie goes DOWN, by convention
        r.hasWinner = true;
        _settle(roundId, r);
    }

    function resolveByCount(uint256 roundId, uint32 count) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.status != 1 || r.kind != 1) revert BadState();
        r.settledCount = count;
        r.winner = count > r.threshold ? UP : DOWN; // UP = OVER
        r.hasWinner = true;
        _settle(roundId, r);
    }

    function _settle(uint256 roundId, Round storage r) private {
        uint16 n = uint16(bettorIds[roundId].length);
        r.status = 2;
        _payRange(roundId, r, 0, n);
        emit Resolved(roundId, r.winner, r.poolUp + r.poolDown, n, _winningPool(r) == 0);
    }

    /// @notice Safety valve for a very large round: pay in slices.
    function resolveChunk(uint256 roundId, uint16 from, uint16 to) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.status != 2 || !r.hasWinner) revert BadState();
        _payRange(roundId, r, from, to);
    }

    function _payRange(uint256 roundId, Round storage r, uint16 from, uint16 to) private {
        uint256 total = uint256(r.poolUp) + uint256(r.poolDown);
        uint256 pw = _winningPool(r);
        uint16[] storage list = bettorIds[roundId];
        uint16 end = to > list.length ? uint16(list.length) : to;
        uint256 paidOut;

        for (uint16 i = from; i < end;) {
            uint16 id = list[i];
            uint128 stake = stakeOf[roundId][id];
            uint128 payout;

            if (pw == 0) {
                payout = stake; // nobody backed the winning side: full refund, never divide by zero
            } else if (sideOf[roundId][id] == r.winner) {
                payout = uint128((uint256(stake) * total) / pw); // multiply before divide
            } else {
                payout = 0;
            }

            if (payout > stake) {
                uint96 gain = uint96(payout - stake);
                players[id - 1].profit += gain; // the score is positive profit only
                emit Paid(roundId, id, payout, players[id - 1].profit);
            } else if (payout > 0) {
                emit Paid(roundId, id, payout, players[id - 1].profit);
            }
            paidOut += payout;

            unchecked {
                ++i;
            }
        }

        paidUpTo[roundId] = end;
        if (total > paidOut) faucetReserve += total - paidOut; // rounding dust
    }

    function _winningPool(Round storage r) private view returns (uint256) {
        return r.winner == UP ? r.poolUp : r.poolDown;
    }

    // --- the MON payout ------------------------------------------------------------------

    /// @notice 100 AURA of profit = 1 MON. The contract computes it; the backend only picks the
    ///         range. One transaction pays the whole room.
    function payoutMon(uint16 from, uint16 to) external onlyOperator {
        uint16 end = to > players.length ? uint16(players.length) : to;
        for (uint16 i = from; i < end;) {
            Player storage p = players[i];
            uint256 amount = (uint256(p.profit) * 1e18) / 100;
            if (amount > 0 && address(this).balance >= amount) {
                p.profit = 0; // paid once
                (bool ok,) = p.addr.call{value: amount}("");
                if (ok) emit MonPaid(i + 1, p.addr, amount);
                else p.profit = uint96(amount * 100 / 1e18); // put it back if the send failed
            }
            unchecked {
                ++i;
            }
        }
    }

    // --- views, for backend rehydration (eth_getLogs only reaches back 100 blocks) ---------

    function playerCount() external view returns (uint256) {
        return players.length;
    }

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    function bettorCount(uint256 roundId) external view returns (uint256) {
        return bettorIds[roundId].length;
    }

    function getRound(uint256 roundId) external view returns (Round memory round, uint256 nBettors) {
        return (rounds[roundId], bettorIds[roundId].length);
    }

    function getPlayers(uint16 from, uint16 to)
        external
        view
        returns (address[] memory addrs, bytes32[] memory names, uint8[] memory avatars, uint96[] memory profits)
    {
        uint16 end = to > players.length ? uint16(players.length) : to;
        uint256 len = end > from ? end - from : 0;
        addrs = new address[](len);
        names = new bytes32[](len);
        avatars = new uint8[](len);
        profits = new uint96[](len);
        for (uint256 i; i < len;) {
            Player storage p = players[from + i];
            addrs[i] = p.addr;
            names[i] = p.name;
            avatars[i] = p.avatar;
            profits[i] = p.profit;
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Multiplier per side, x100, as displayed at a reveal. Before any real stake the
    ///         display uses (T+k)/(P+1) with k = 2 — cosmetic only, never stored.
    function mult(uint256 roundId) external view returns (uint32 upX100, uint32 downX100) {
        Round storage r = rounds[roundId];
        uint256 total = uint256(r.poolUp) + uint256(r.poolDown);
        if (total == 0) return (200, 200);
        upX100 = r.poolUp == 0 ? uint32((100 * (total + 2)) / 1) : uint32((100 * total) / r.poolUp);
        downX100 = r.poolDown == 0 ? uint32((100 * (total + 2)) / 1) : uint32((100 * total) / r.poolDown);
    }

    function setRelayer(address a) external onlyOperator {
        relayer = a;
        cannotTrade[a] = true;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Auramaxx} from "../src/Auramaxx.sol";

/// Six tests, no more. Each one guards a way the live demo could break.
contract AuramaxxTest is Test {
    Auramaxx internal a;

    uint256 constant PK1 = 0xA11CE;
    uint256 constant PK2 = 0xB0B;
    uint256 constant PK3 = 0xCA11;
    address p1;
    address p2;
    address p3;

    function setUp() public {
        a = new Auramaxx(address(0xBEEF));
        p1 = vm.addr(PK1);
        p2 = vm.addr(PK2);
        p3 = vm.addr(PK3);

        address[] memory who = new address[](3);
        bytes32[] memory names = new bytes32[](3);
        uint8[] memory avatars = new uint8[](3);
        who[0] = p1;
        who[1] = p2;
        who[2] = p3;
        names[0] = "alice";
        names[1] = "bob";
        names[2] = "carol";
        a.joinBatch(who, names, avatars);
    }

    function _entry(uint256 pk, address player, uint256 roundId, uint8 side, uint128 stake, uint32 nonce)
        internal
        view
        returns (Auramaxx.Entry memory e)
    {
        bytes32 h =
            keccak256(abi.encodePacked("AURAMAXX", block.chainid, address(a), roundId, player, side, stake, nonce));
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, signed);
        e = Auramaxx.Entry({player: player, side: side, stake: stake, nonce: nonce, sig: abi.encodePacked(r, s, v)});
    }

    function _open() internal returns (uint256 id) {
        id = a.openRound(0, uint64(block.number + 100));
    }

    /// What a player has put on the table this round, both sides together.
    function _committed(uint256 roundId, uint16 id) internal view returns (uint128) {
        (uint128 up, uint128 down) = a.betsOf(roundId, id);
        return up + down;
    }

    /// 1. Pro-rata payout, computed on money, with dust bounded by the number of winners.
    function test_payout_is_pro_rata_and_dust_is_bounded() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](3);
        es[0] = _entry(PK1, p1, id, 0, 100, 1); // UP
        es[1] = _entry(PK2, p2, id, 0, 200, 1); // UP
        es[2] = _entry(PK3, p3, id, 1, 300, 1); // DOWN
        a.commitBatch(id, es);
        a.freeze(id);
        a.resolveByPrice(id, 100, 101); // UP wins

        // total 600, winning pool 300 -> alice 100*600/300 = 200 (profit 100), bob 400 (profit 200)
        (,,, uint96 profits) = _profiles();
        assertEq(profits, 0, "carol lost everything");
        (address[] memory addrs,,, uint96[] memory ps) = a.getPlayers(0, 3);
        assertEq(addrs[0], p1);
        assertEq(ps[0], 100, "alice profit");
        assertEq(ps[1], 200, "bob profit");
        assertEq(ps[2], 0, "carol profit");
        assertLe(a.faucetReserve(), 2, "dust bounded by winner count");
    }

    function _profiles() internal view returns (address, bytes32, uint8, uint96) {
        (address[] memory addrs, bytes32[] memory names, uint8[] memory av, uint96[] memory ps) = a.getPlayers(2, 3);
        return (addrs[0], names[0], av[0], ps[0]);
    }

    /// 2. Nobody on the winning side: everyone is refunded, never a division by zero.
    function test_empty_winning_pool_refunds_everyone() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](2);
        es[0] = _entry(PK1, p1, id, 1, 500, 1); // both on DOWN
        es[1] = _entry(PK2, p2, id, 1, 500, 1);
        a.commitBatch(id, es);
        a.freeze(id);
        a.resolveByPrice(id, 100, 101); // UP wins, and UP is empty

        (,,, uint96[] memory ps) = a.getPlayers(0, 2);
        assertEq(ps[0], 0, "refund is not profit");
        assertEq(ps[1], 0);
        assertEq(a.faucetReserve(), 0, "refund leaves no dust");
    }

    /// 3. A replayed nonce is ignored.
    function test_replayed_nonce_is_ignored() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](1);
        es[0] = _entry(PK1, p1, id, 0, 100, 1);
        a.commitBatch(id, es);
        a.commitBatch(id, es); // same nonce again
        assertEq(_committed(id, 1), 100, "second commit ignored");
    }

    /// 4. A stake above what is left of the 1,000 is clamped, not reverted.
    function test_stake_is_clamped_to_remaining_budget() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](2);
        es[0] = _entry(PK1, p1, id, 0, 800, 1);
        es[1] = _entry(PK1, p1, id, 0, 800, 2); // only 200 left
        a.commitBatch(id, es);
        assertEq(_committed(id, 1), 1000, "clamped to the 1000 budget");
    }

    /// 5. One bad entry does not destroy the other nineteen.
    function test_bad_entry_does_not_kill_the_batch() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](3);
        es[0] = _entry(PK1, p1, id, 0, 100, 1);
        es[1] = _entry(PK2, p1, id, 0, 100, 1); // signed by bob, claims to be alice -> bad sig
        es[2] = _entry(PK3, p3, id, 1, 100, 1);
        a.commitBatch(id, es);
        assertEq(_committed(id, 1), 100, "alice went through");
        assertEq(_committed(id, 3), 100, "carol went through");
        assertEq(a.bettorCount(id), 2, "the forged one was skipped");
    }

    /// 6. Both sides at once: the two legs are stored separately and the 1,000 caps them together.
    function test_both_sides_are_kept_separately() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](3);
        es[0] = _entry(PK1, p1, id, 0, 100, 1); // UP
        es[1] = _entry(PK1, p1, id, 1, 300, 2); // and DOWN, in the same round
        es[2] = _entry(PK1, p1, id, 0, 900, 3); // 600 left, so this one is clamped
        a.commitBatch(id, es);

        (uint128 up, uint128 down) = a.betsOf(id, 1);
        assertEq(up, 700, "100 + 600 after the clamp");
        assertEq(down, 300, "the other leg is untouched");
        assertEq(up + down, 1000, "the budget caps the two together");

        (Auramaxx.Round memory r,) = a.getRound(id);
        assertEq(r.poolUp, 700, "both legs reach their pool");
        assertEq(r.poolDown, 300);
        assertEq(a.bettorCount(id), 1, "one player, counted once");
    }

    /// 6bis. A hedged player is paid on the winning leg and loses the other, like everyone else.
    ///  UP: alice 300 + bob 200 = 500. DOWN: alice 100 + carol 400 = 500. T = 1000, UP wins.
    ///  alice 300*1000/500 = 600 against 400 committed -> profit 200
    ///  bob   200*1000/500 = 400 against 200 committed -> profit 200
    function test_hedged_player_is_paid_on_the_winning_leg_only() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](4);
        es[0] = _entry(PK1, p1, id, 0, 300, 1);
        es[1] = _entry(PK1, p1, id, 1, 100, 2);
        es[2] = _entry(PK2, p2, id, 0, 200, 1);
        es[3] = _entry(PK3, p3, id, 1, 400, 1);
        a.commitBatch(id, es);
        a.freeze(id);
        a.resolveByPrice(id, 100, 101); // UP wins

        (,,, uint96[] memory ps) = a.getPlayers(0, 3);
        assertEq(ps[0], 200, "alice: 600 back on 400 committed");
        assertEq(ps[1], 200, "bob: 400 back on 200 committed");
        assertEq(ps[2], 0, "carol backed the losing side only");
        assertEq(a.faucetReserve(), 0, "the pools divide exactly here");
    }

    /// 6ter. Hedging is not free: backing both sides evenly gives the stake back, never a profit.
    function test_hedging_both_sides_cannot_manufacture_profit() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](2);
        es[0] = _entry(PK1, p1, id, 0, 500, 1);
        es[1] = _entry(PK1, p1, id, 1, 500, 2);
        a.commitBatch(id, es);
        a.freeze(id);
        a.resolveByPrice(id, 100, 101); // UP wins, and alice is the whole book

        (,,, uint96[] memory ps) = a.getPlayers(0, 1);
        assertEq(ps[0], 0, "1000 in, 1000 out: no profit from hedging");
    }

    /// 7bis. Asymmetric pools with real rounding — the case a symmetric test cannot catch.
    ///  UP: alice 100 + bob 150 = 250. DOWN: carol 251. T = 501, UP wins.
    ///  alice 100*501/250 = 200.4 -> 200 (profit 100)
    ///  bob   150*501/250 = 300.6 -> 300 (profit 150)
    ///  paid 500, dust 1, and dust must be strictly less than the number of winners.
    function test_asymmetric_payout_and_real_dust() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](3);
        es[0] = _entry(PK1, p1, id, 0, 100, 1);
        es[1] = _entry(PK2, p2, id, 0, 150, 1);
        es[2] = _entry(PK3, p3, id, 1, 251, 1);
        a.commitBatch(id, es);

        (uint32 upX100, uint32 downX100) = a.mult(id);
        assertEq(uint256(upX100), (uint256(100) * 501) / 250, "up multiplier 2.00x");
        assertEq(uint256(downX100), (uint256(100) * 501) / 251, "down multiplier 1.99x");

        a.freeze(id);
        a.resolveByPrice(id, 100, 101); // UP wins

        (,,, uint96[] memory ps) = a.getPlayers(0, 3);
        assertEq(ps[0], 100, "alice profit 200-100");
        assertEq(ps[1], 150, "bob profit 300-150");
        assertEq(ps[2], 0, "carol lost");
        assertEq(a.faucetReserve(), 1, "exactly 1 chip of dust");
        assertLt(a.faucetReserve(), 2, "dust is bounded by the winner count");
    }

    /// 7ter. An empty side must display a defined multiplier, never zero and never a revert.
    function test_empty_side_multiplier_is_defined() public {
        uint256 id = _open();
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](1);
        es[0] = _entry(PK1, p1, id, 0, 400, 1); // everyone on UP
        a.commitBatch(id, es);

        (uint32 upX100, uint32 downX100) = a.mult(id);
        assertEq(uint256(upX100), (uint256(100) * 400) / 400, "1.00x when you are the whole pool");
        assertEq(uint256(downX100), (uint256(100) * (400 + 2)) / 1, "regularised, not zero");
        assertGt(downX100, 0, "the phone must never show 0.00x");
    }

    /// 8. The magenta threshold comes from the REGISTERED players, not from who happened to bet.
    ///    Abstaining must not lower the bar the room has to clear.
    function test_threshold_counts_registered_players_not_bettors() public {
        uint256 id = a.openRound(1, uint64(block.number + 100));
        Auramaxx.Entry[] memory es = new Auramaxx.Entry[](1);
        es[0] = _entry(PK1, p1, id, 0, 100, 1); // one bettor out of three registered
        a.commitBatch(id, es);
        a.freeze(id);

        (Auramaxx.Round memory r,) = a.getRound(id);
        assertEq(a.bettorCount(id), 1, "only alice bet");
        assertEq(uint256(r.threshold), (uint256(3) * 11 * 45) / 100, "45% of registered * TICKS = 14");
        assertGt(uint256(r.threshold), (uint256(1) * 11 * 45) / 100, "abstaining does not lower the bar");

        a.resolveByCount(id, r.threshold + 1); // OVER wins
        (,,, uint96[] memory ps) = a.getPlayers(0, 3);
        assertEq(ps[0], 0, "alice was the whole book: refunded, not enriched");
    }
}

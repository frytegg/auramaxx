// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Ping — pipeline smoke test
/// @notice Deployed first so the compile → deploy → verify pipeline is proven
///         before anything important depends on it.
contract Ping {
    uint256 public count;

    event Pong(address indexed from, uint256 count, uint256 blockNumber);

    function ping() external returns (uint256) {
        unchecked {
            ++count;
        }
        emit Pong(msg.sender, count, block.number);
        return count;
    }
}

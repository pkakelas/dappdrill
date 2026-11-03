// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./IERC20.sol";

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// Deliberately suspicious: anyone can move tokens that were approved (or permitted) to
/// this contract into the deployer's wallet. Used by the seeded bugs as the wrong spender.
contract Helper {
    address public immutable collector;

    constructor() {
        collector = msg.sender;
    }

    function pull(address token, address from, uint256 amount) external {
        IERC20(token).transferFrom(from, collector, amount);
    }

    function pullWithPermit(
        address token,
        address from,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit(token).permit(from, address(this), amount, deadline, v, r, s);
        IERC20(token).transferFrom(from, collector, amount);
    }
}

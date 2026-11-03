// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./IERC20.sol";

interface IVault {
    function balanceOf(address owner) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

/// Pays a deposit bonus in hUSDC: 5% of a depositor's current position, minus what they
/// already claimed. Funded up front by the deployer.
contract RewardsDistributor {
    uint256 public constant BONUS_BPS = 500;

    IERC20 public immutable token;
    IVault public immutable vault;
    mapping(address => uint256) public claimed;

    event Claimed(address indexed user, uint256 amount);

    constructor(IERC20 token_, IVault vault_) {
        token = token_;
        vault = vault_;
    }

    function claimable(address user) public view returns (uint256) {
        uint256 earned = vault.convertToAssets(vault.balanceOf(user)) * BONUS_BPS / 10_000;
        return earned > claimed[user] ? earned - claimed[user] : 0;
    }

    function claim() external returns (uint256 amount) {
        amount = claimable(msg.sender);
        require(amount > 0, "rewards: nothing to claim");
        claimed[msg.sender] += amount;
        token.transfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }
}

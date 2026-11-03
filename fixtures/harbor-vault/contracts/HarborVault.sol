// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "./IERC20.sol";

/// ERC-4626-lite vault over hUSDC. Shares are non-transferable; yield arrives as plain
/// hUSDC transfers into the vault, which raises the share price.
contract HarborVault {
    string public constant name = "Harbor hUSDC Vault";
    string public constant symbol = "hvUSDC";
    uint8 public constant decimals = 6;

    IERC20 public immutable asset;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares
    );

    constructor(IERC20 asset_) {
        asset = asset_;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return totalSupply == 0 ? assets : assets * totalSupply / totalAssets();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return totalSupply == 0 ? shares : shares * totalAssets() / totalSupply;
    }

    /// Shares burned to withdraw `assets`, rounded up.
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        if (totalSupply == 0) return assets;
        uint256 total = totalAssets();
        return (assets * totalSupply + total - 1) / total;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = convertToShares(assets);
        require(shares > 0, "vault: zero shares");
        asset.transferFrom(msg.sender, address(this), assets);
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = previewWithdraw(assets);
        _exit(owner, receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        assets = convertToAssets(shares);
        _exit(owner, receiver, assets, shares);
    }

    function _exit(address owner, address receiver, uint256 assets, uint256 shares) internal {
        require(msg.sender == owner, "vault: not owner");
        require(balanceOf[owner] >= shares, "vault: insufficient shares");
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        asset.transfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }
}

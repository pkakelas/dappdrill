// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Minimal ERC-20 used by the engine runtime tests. Balances live in slot 0.
contract TestToken {
    string public name = "Test USD";
    string public symbol = "TUSD";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "insufficient allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// Deposit-like target: pulls tokens with transferFrom and credits shares 1:1.
contract TestVault {
    TestToken public immutable token;
    mapping(address => uint256) public shares;

    event Deposit(address indexed who, uint256 amount);

    constructor(TestToken t) {
        token = t;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(token.transferFrom(msg.sender, address(this), amount), "transfer failed");
        shares[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }
}

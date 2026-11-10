/**
 * Built-in knowledge: ABIs for the standards and routers most dApps call, and
 * the addresses of contracts we recognise without looking anything up.
 */
import { parseAbi, type Abi, type Address } from "viem";

export const BUILTIN_ABI: Abi = parseAbi([
  // ERC-20 + EIP-2612 + DAI permit + ERC-3009
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  // ERC-721 / ERC-1155
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  // WETH
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  // ERC-4626
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function mint(uint256 shares, address receiver) returns (uint256)",
  // Mintable test tokens and faucets
  "function mint(address to, uint256 amount)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function asset() view returns (address)",
  // Permit2
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)",
  "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature)",
  "function transferFrom(address from, address to, uint160 amount, address token)",
  "function permitTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes signature)",
  "function lockdown((address token, address spender)[] approvals)",
  // Multicall (OZ / Uniswap style) + Multicall3
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[] results)",
  "function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)",
  "function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  // Uniswap Universal Router
  "function execute(bytes commands, bytes[] inputs) payable",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  // Uniswap V2-style routers
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)",
  // Uniswap V3 SwapRouter / SwapRouter02
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  // Proxies
  "function implementation() view returns (address)",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
]);

/** Event ABI used to read receipts. */
export const TRANSFER_EVENTS_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
]);

export const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const MULTICALL3_ADDRESS: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

interface Known {
  name: string;
  /** Token symbol, when the contract is a token. */
  symbol?: string;
  decimals?: number;
}

/** Same address on every chain (CREATE2 deployments). */
const KNOWN_EVERYWHERE: Record<string, Known> = {
  [PERMIT2_ADDRESS.toLowerCase()]: { name: "Permit2 (Uniswap)" },
  [MULTICALL3_ADDRESS.toLowerCase()]: { name: "Multicall3" },
  "0x0000000000000068f116a894984e2db1123eb395": { name: "Seaport 1.6 (OpenSea)" },
  "0x00000000000000adc04c56bf30ac9d3c0aaf14dc": { name: "Seaport 1.5 (OpenSea)" },
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": { name: "Uniswap Universal Router v2" },
};

/** Per chain: canonical tokens and routers. Keys are lowercase addresses. */
const KNOWN_BY_CHAIN: Record<number, Record<string, Known>> = {
  1: {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { name: "Tether USD", symbol: "USDT", decimals: 6 },
    "0x6b175474e89094c44da98b954eedeac495271d0f": { name: "Dai Stablecoin", symbol: "DAI", decimals: 18 },
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { name: "Wrapped BTC", symbol: "WBTC", decimals: 8 },
    "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": { name: "Uniswap Universal Router" },
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": { name: "Uniswap V3 SwapRouter02" },
    "0xe592427a0aece92de3edee1f18e0157c05861564": { name: "Uniswap V3 SwapRouter" },
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": { name: "Uniswap V2 Router" },
    "0x1111111254eeb25477b68fb85ed929f73a960582": { name: "1inch AggregationRouter v5" },
    "0x111111125421ca6dc452d289314280a0f8842a65": { name: "1inch AggregationRouter v6" },
  },
  8453: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0x4200000000000000000000000000000000000006": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { name: "Dai Stablecoin", symbol: "DAI", decimals: 18 },
    "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": { name: "Uniswap Universal Router" },
    "0x2626664c2603336e57b271c5c0b26f421741e481": { name: "Uniswap V3 SwapRouter02" },
  },
  42161: {
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { name: "Tether USD", symbol: "USDT", decimals: 6 },
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { name: "Dai Stablecoin", symbol: "DAI", decimals: 18 },
  },
  10: {
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0x4200000000000000000000000000000000000006": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { name: "Dai Stablecoin", symbol: "DAI", decimals: 18 },
  },
  137: {
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { name: "USD Coin", symbol: "USDC", decimals: 6 },
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": { name: "Wrapped Ether", symbol: "WETH", decimals: 18 },
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": { name: "Wrapped POL", symbol: "WPOL", decimals: 18 },
  },
};

export function knownContract(chainId: number, address: Address): Known | undefined {
  const key = address.toLowerCase();
  return KNOWN_BY_CHAIN[chainId]?.[key] ?? KNOWN_EVERYWHERE[key];
}

/** Uniswap Universal Router command bytes → names (v1.x / v2). */
export const UNIVERSAL_ROUTER_COMMANDS: Record<number, string> = {
  0x00: "V3_SWAP_EXACT_IN",
  0x01: "V3_SWAP_EXACT_OUT",
  0x02: "PERMIT2_TRANSFER_FROM",
  0x03: "PERMIT2_PERMIT_BATCH",
  0x04: "SWEEP",
  0x05: "TRANSFER",
  0x06: "PAY_PORTION",
  0x08: "V2_SWAP_EXACT_IN",
  0x09: "V2_SWAP_EXACT_OUT",
  0x0a: "PERMIT2_PERMIT",
  0x0b: "WRAP_ETH",
  0x0c: "UNWRAP_WETH",
  0x0d: "PERMIT2_TRANSFER_FROM_BATCH",
  0x0e: "BALANCE_CHECK_ERC20",
  0x10: "V4_SWAP",
  0x11: "V3_POSITION_MANAGER_PERMIT",
  0x12: "V3_POSITION_MANAGER_CALL",
  0x13: "V4_INITIALIZE_POOL",
  0x14: "V4_POSITION_MANAGER_CALL",
  0x21: "EXECUTE_SUB_PLAN",
};

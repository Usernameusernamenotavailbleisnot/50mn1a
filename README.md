# 50mn1a Bot

A Web3 automation bot for the 50mn1a Testnet that handles contract deployment, NFT minting, and token management with dynamic gas estimation.

## Features

- Automatic wallet management from private keys in various formats
- Dynamic gas estimation with appropriate buffers
- Contract compilation and deployment
- NFT minting with customizable collections
- ERC-20 token deployment with random names
- Proxy support for faucet claiming
- Team wallet transfers
- Configurable retry mechanism
- Detailed logging

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

## Configuration

### Required Files

1. **config.json**: Main configuration file
2. **pk.txt**: File containing private keys (one per line)
3. **proxy.txt**: File containing proxy addresses (one per line)

### Config.json Structure

```json
{
  "features": {
    "claimFaucet": true,
    "deployContracts": true,
    "transferToTeam": true
  },
  "deployments": {
    "confidentialERC20Count": 1,
    "nftCount": 1,
    "memeTokenCount": 1
  },
  "transfers": {
    "amount": "0.001"
  },
  "delays": {
    "min": 5000,
    "max": 15000
  },
  "retry": {
    "maxAttempts": 3,
    "delayBetweenRetries": 5000
  }
}
```

## Usage

Run the bot with:

```bash
node index.js
```

The bot will:
1. Load private keys and proxies
2. Process each wallet sequentially
3. Check balance and claim from faucet if enabled
4. Deploy contracts according to configuration
5. Transfer funds to team wallets if enabled
6. Wait for the configured cycle time before restarting

## Smart Contracts

The bot can deploy:

1. **ConfidentialERC20**: Standard ERC-20 token with confidential addresses feature
2. **NFT**: ERC-721 NFT collection with minting functionality
3. **MemeToken**: ERC-20 token with meme-themed naming

## Gas Management

The bot uses dynamic gas estimation with safety buffers:
- 10% buffer on gas price
- 50% buffer on gas limit
- Fallback values for cases where estimation fails

## Error Handling

The system includes comprehensive error handling with:
- Retry mechanism for transient errors
- Skip logic for insufficient funds
- Formatted error logging

## License

MIT

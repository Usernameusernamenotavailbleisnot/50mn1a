const Web3 = require('web3');
const fs = require('fs');
const axios = require('axios');
const chalk = require('chalk');
const {HttpsProxyAgent} = require('https-proxy-agent');
const { setTimeout } = require('timers/promises');
const solc = require('solc');

// Load configuration files
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const privateKeysRaw = fs.readFileSync('./pk.txt', 'utf8').split('\n');
const privateKeys = [];

for (let i = 0; i < privateKeysRaw.length; i++) {
    try {
        const normalizedPk = normalizePrivateKey(privateKeysRaw[i]);
        if (normalizedPk) {
            privateKeys.push(normalizedPk);
        } else {
            console.warn(`Skipping invalid private key at line ${i + 1}`);
        }
    } catch (error) {
        console.error(`Error processing key at line ${i + 1}: ${error.message}`);
    }
}
const proxies = fs.readFileSync('./proxy.txt', 'utf8').split('\n').filter(proxy => proxy.trim());
console.log(`Loaded ${privateKeys.length} valid private keys out of ${privateKeysRaw.length} entries`);

// Network configuration
const NETWORK = {
    chainId: 50312,
    name: 'Somnia Testnet',
    rpcUrl: 'https://dream-rpc.somnia.network',
    symbol: 'STT',
    explorer: 'https://somnia-testnet.socialscan.io/'
};

// Team wallets for transfers
const TEAM_WALLETS = [
    '0xDA1feA7873338F34C6915A44028aA4D9aBA1346B',
    '0x018604C67a7423c03dE3057a49709aaD1D178B85',
    '0xcF8D30A5Ee0D9d5ad1D7087822bA5Bab1081FdB7',
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5'
];

// Initialize Web3
const web3 = new Web3(new Web3.providers.HttpProvider(NETWORK.rpcUrl));

// Updated Gas Estimator using Web3
class GasEstimator {
    constructor(web3Instance) {
        this.web3 = web3Instance;
    }

    async getGasPrice() {
        try {
            const gasPrice = await this.web3.eth.getGasPrice();
            // Add a small buffer for gas price
            const gasPriceWithBuffer = Math.floor(Number(gasPrice) * 1.1);
            return this.web3.utils.toHex(gasPriceWithBuffer);
        } catch (error) {
            console.log('Gas price estimation failed, using fallback value');
            return this.web3.utils.toHex(this.web3.utils.toWei('5', 'gwei'));
        }
    }

    async estimateGas(txData) {
        try {
            const gasEstimate = await this.web3.eth.estimateGas(txData);
            // Add a 50% buffer to the gas estimate
            const gasWithBuffer = Math.floor(Number(gasEstimate) * 1.5);
            return this.web3.utils.toHex(gasWithBuffer);
        } catch (error) {
            console.log(`Gas estimation failed: ${error.message}`);
            
            // Fallback gas limits based on operation type
            if (txData.data) {
                if (txData.data.length > 1000) {
                    // Contract deployment
                    return this.web3.utils.toHex(4000000);
                } else {
                    // Contract interaction
                    return this.web3.utils.toHex(500000);
                }
            } else {
                // Simple transfer
                return this.web3.utils.toHex(30000);
            }
        }
    }

    async getGasForTransaction(txData) {
        const gasPrice = await this.getGasPrice();
        const gasLimit = await this.estimateGas(txData);
        
        //console.log(`Using gas price: ${this.web3.utils.fromWei(this.web3.utils.hexToNumberString(gasPrice), 'gwei')} gwei, limit: ${this.web3.utils.hexToNumber(gasLimit)}`);
        
        return {
            gasPrice,
            gas: gasLimit
        };
    }
}

function normalizePrivateKey(pk) {
    // Hapus whitespace
    let cleanPk = pk.trim();
    
    // Jika kosong, return null
    if (!cleanPk) return null;
    
    try {
        // Format 1: Mnemonik/Seed Phrase
        if (cleanPk.includes(' ') && cleanPk.split(' ').length >= 12) {
            const wallet = web3.eth.accounts.privateKeyToAccount(web3.eth.accounts.create().privateKey);
            return wallet.privateKey;
        }
        
        // Format 2: Hex string tanpa 0x
        const hexRegex = /^[0-9a-fA-F]{64}$/;
        if (hexRegex.test(cleanPk)) {
            return `0x${cleanPk}`;
        }
        
        // Format 3: Hex string dengan 0x
        const hexWithPrefixRegex = /^0x[0-9a-fA-F]{64}$/;
        if (hexWithPrefixRegex.test(cleanPk)) {
            return cleanPk;
        }
        
        // Format tidak dikenali
        console.warn(`Unrecognized private key format: ${cleanPk.substring(0, 10)}...`);
        return null;
    } catch (error) {
        console.error(`Error normalizing private key: ${error.message}`);
        return null;
    }
}

// Contract Sources (unchanged)
const CONTRACT_SOURCES = {
    "ConfidentialERC20": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ConfidentialERC20 is ERC20, Ownable {
    mapping(address => bool) private _confidentialAddresses;
    
    constructor(string memory name, string memory symbol) 
        ERC20(name, symbol)
        Ownable(msg.sender)
    {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
    
    function setConfidential(address account, bool status) public onlyOwner {
        _confidentialAddresses[account] = status;
    }
    
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}`
    },
    "NFT": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract NFT is ERC721, Ownable {
    uint256 private _nextTokenId;
    string private _baseTokenURI;
    uint256 public immutable maxSupply;
    uint256 public price;

    constructor(
        string memory name,
        string memory symbol,
        string memory baseURI,
        uint256 _maxSupply,
        uint256 _price
    ) ERC721(name, symbol) Ownable(msg.sender) {
        _baseTokenURI = baseURI;
        maxSupply = _maxSupply;
        price = _price;
    }

    function mint() public payable {
        require(msg.value >= price, "Insufficient payment");
        require(_nextTokenId < maxSupply, "Max supply reached");
        
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        
        _safeMint(msg.sender, tokenId);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string memory baseURI) public onlyOwner {
        _baseTokenURI = baseURI;
    }

    function withdraw() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}`
    },
    "MemeToken": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MemeToken is ERC20, Ownable {
    constructor(string memory name, string memory symbol) 
        ERC20(name, symbol)
        Ownable(msg.sender)
    {
        _mint(msg.sender, 1000000000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}`
    }
};

function maskAddress(address) {
    if (!address) return address;
    if (address.length < 8) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Logger utility (unchanged)
const Logger = {
    log: (wallet, message) => {
        const maskedWallet = typeof wallet === 'string' ? maskAddress(wallet) : maskAddress(wallet);
        console.log(chalk.blue(`[${new Date().toLocaleString()}] [${maskedWallet}] ${message}`));
    },
    error: (wallet, message) => {
        const maskedWallet = typeof wallet === 'string' ? maskAddress(wallet) : maskAddress(wallet);
        let cleanMessage = message;
        
        if (message.includes('code=')) {
            const codeMatch = message.match(/code=([A-Z_]+)/);
            if (codeMatch) {
                cleanMessage = codeMatch[1];
            }
        }
        
        if (message.includes('reason=')) {
            const reasonMatch = message.match(/reason="([^"]+)"/);
            if (reasonMatch) {
                cleanMessage = reasonMatch[1];
            }
        }
        
        cleanMessage = cleanMessage.replace(/transaction=\{[^}]+\}/, '')
                                 .replace(/requestBody=\{[^}]+\}/, '')
                                 .replace(/\s*\[\s*See:[^\]]+\]\s*/, '');
        
        console.error(chalk.red(`[${new Date().toLocaleString()}] [${maskedWallet}] ERROR: ${cleanMessage}`));
    },
    success: (wallet, message) => {
        const maskedWallet = typeof wallet === 'string' ? maskAddress(wallet) : maskAddress(wallet);
        console.log(chalk.green(`[${new Date().toLocaleString()}] [${maskedWallet}] SUCCESS: ${message}`));
    }
};

// Helper function untuk membersihkan pesan error
function cleanErrorMessage(error) {
    let message = error.message || error;
    
    if (typeof message === 'object') {
        return error.code || 'Unknown error';
    }
    
    if (message.includes('code=')) {
        const codeMatch = message.match(/code=([A-Z_]+)/);
        if (codeMatch) return codeMatch[1];
    }
    
    if (message.includes('reason=')) {
        const reasonMatch = message.match(/reason="([^"]+)"/);
        if (reasonMatch) return reasonMatch[1];
    }
    
    // Buang semua data yang tidak perlu
    message = message.replace(/transaction=\{[^}]+\}/, '')
                    .replace(/requestBody=\{[^}]+\}/, '')
                    .replace(/\s*\[\s*See:[^\]]+\]\s*/, '')
                    .trim();
    
    return message;
}

function isInsufficientFundsError(error) {
    const message = error.message || error.toString();
    return message.includes('INSUFFICIENT_FUNDS') || 
           message.includes('insufficient funds') ||
           message.toLowerCase().includes('insufficient balance');
}

// Updated retry mechanism 
async function withRetry(operation, maxRetries = config.retry.maxAttempts, delayBetweenRetries = config.retry.delayBetweenRetries) {
    try {
        return await operation();
    } catch (error) {
        // Skip retries on insufficient funds
        if (isInsufficientFundsError(error)) {
            Logger.error('Wallet', `Insufficient funds, skipping retries: ${cleanErrorMessage(error)}`);
            throw error;
        }

        // Continue with retry for other errors
        let lastError = error;
        for (let attempt = 1; attempt < maxRetries; attempt++) {
            try {
                const delay = delayBetweenRetries * attempt;
                Logger.log('Retry', `Waiting ${delay}ms before next attempt...`);
                await setTimeout(delay);
                return await operation();
            } catch (error) {
                lastError = error;
                // Exit loop on insufficient funds
                if (isInsufficientFundsError(error)) {
                    Logger.error('Wallet', `Insufficient funds, stopping retries: ${cleanErrorMessage(error)}`);
                    throw error;
                }
                Logger.error('Retry', `Attempt ${attempt + 1}/${maxRetries} failed: ${cleanErrorMessage(error)}`);
            }
        }
        throw lastError;
    }
}

// Contract Deployer Class using Web3
class ContractDeployer {
    constructor(privateKey) {
        this.web3 = web3;
        this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
        this.web3.eth.accounts.wallet.add(this.account);
        this.address = this.account.address;
    }

    async compileAndDeployContract(contractName, ...args) {
        return await withRetry(async () => {
            try {
                Logger.log(this.address, `Compiling ${contractName}...`);
                
                const input = {
                    language: 'Solidity',
                    sources: {
                        [contractName]: CONTRACT_SOURCES[contractName]
                    },
                    settings: {
                        outputSelection: {
                            '*': {
                                '*': ['*']
                            }
                        },
                        optimizer: {
                            enabled: true,
                            runs: 200
                        }
                    }
                };

                function findImports(path) {
                    try {
                        if (path.startsWith('@openzeppelin/')) {
                            const npmPath = require.resolve(path);
                            return {
                                contents: fs.readFileSync(npmPath, 'utf8')
                            };
                        }
                        return { error: `File not found: ${path}` };
                    } catch (error) {
                        return { error: `File not found: ${path}` };
                    }
                }

                const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

                if (output.errors) {
                    const errors = output.errors.filter(e => e.severity === 'error');
                    if (errors.length > 0) {
                        throw new Error(`Compilation errors: ${errors.map(e => e.message).join(', ')}`);
                    }
                }

                if (!output.contracts || !output.contracts[contractName] || !output.contracts[contractName][contractName]) {
                    throw new Error(`Contract ${contractName} compilation output is invalid`);
                }

                const contract = output.contracts[contractName][contractName];
                Logger.log(this.address, `Deploying ${contractName}...`);

                // Create contract instance
                const Contract = new this.web3.eth.Contract(contract.abi);
                
                // Encode constructor arguments
                const constructorArguments = Contract.deploy({
                    data: '0x' + contract.evm.bytecode.object,
                    arguments: args
                }).encodeABI();
                
                // Create transaction data
                const txData = {
                    from: this.address,
                    data: constructorArguments
                };
                
                // Use gas estimator
                const gasEstimator = new GasEstimator(this.web3);
                const gasSettings = await gasEstimator.getGasForTransaction(txData);
                
                // Deploy the contract
                const deployTx = await this.web3.eth.accounts.signTransaction(
                    {
                        from: this.address,
                        data: constructorArguments,
                        ...gasSettings
                    },
                    this.account.privateKey
                );
                
                Logger.log(this.address, `Sending deployment transaction...`);
                const receipt = await this.web3.eth.sendSignedTransaction(deployTx.rawTransaction);
                
                // Create contract instance at the deployed address
                const deployedContract = new this.web3.eth.Contract(
                    contract.abi,
                    receipt.contractAddress
                );
                
                deployedContract.options.from = this.address;
                deployedContract.options.address = receipt.contractAddress;
                
                Logger.success(this.address, `${contractName} deployed at ${receipt.contractAddress}`);
                
                return deployedContract;
            } catch (error) {
                Logger.error(this.address, `Failed to deploy ${contractName}: ${error.message}`);
                throw error;
            }
        });
    }

    async deployConfidentialERC20() {
        const names = [
            'Stealth', 'Shadow', 'Ghost', 'Phantom', 'Enigma', 'Cipher', 'Secret', 'Mystic', 'Covert', 'Obscure',
            'Whisper', 'Phantom', 'Mirage', 'Eclipse', 'Noir', 'Veil', 'Silhouette', 'Shade', 'Umbra', 'Spectre',
            'Wraith', 'Twilight', 'Illusion', 'Arcane', 'Nebula', 'Occult', 'Nimbus', 'Incognito', 'Cloak', 'Shroud',
            'Revenant', 'Dusk', 'Nocturne', 'Phantom', 'Eerie', 'Ethereal', 'Hidden', 'Discreet', 'Anonymous', 'Clandestine'
        ];
        
        const name = names[Math.floor(Math.random() * names.length)];
        const symbolLength = Math.floor(Math.random() * 3) + 2;
        const symbol = name.slice(0, symbolLength).toUpperCase();
        
        return await this.compileAndDeployContract("ConfidentialERC20", name, symbol);
    }

    async deployMemeToken() {
        const memeNames = [
            'PEPE', 'DOGE', 'SHIB', 'MOON', 'CHAD', 'WOJAK', 'CHEEMS', 'BONK', 'FROG', 'APE',
            'SNEK', 'HONK', 'STONK', 'DINO', 'HODL', 'MEME', 'GIGA', 'ALPHA', 'SIGMA', 'BETA',
            'CATTO', 'DOGGO', 'BIRB', 'PHROG', 'TOAD', 'BENIS', 'MONKE', 'PANDA', 'DOOT', 'YEET',
            'BOOMER', 'ZOOMER', 'CHONK', 'DANK', 'WAGMI', 'NGMI', 'MOAI', 'NOOT', 'PAMP', 'DUMP',
            'FOMO', 'COPIUM', 'RARE', 'BOBO', 'WOOF', 'MEOW', 'GUCCI', 'LAMBO', 'REKT', 'BASED'
        ];
        
        const prefixes = ['', 'Baby', 'Mega', 'Super', 'Hyper', 'Ultra', 'Based', 'Sigma', 'Alpha', 'Gigachad', 'Epic', 'Dank', 'Lit', 'Smol', 'Thicc'];
        const suffixes = ['', 'Inu', 'Moon', 'Rocket', 'Elon', 'Coin', 'DAO', 'Finance', 'Cash', 'X', 'AI', 'World', 'Verse', 'Chain', 'Labs'];
        
        const prefix = Math.random() > 0.7 ? prefixes[Math.floor(Math.random() * prefixes.length)] : '';
        const baseName = memeNames[Math.floor(Math.random() * memeNames.length)];
        const suffix = Math.random() > 0.6 ? suffixes[Math.floor(Math.random() * suffixes.length)] : '';
        
        const symbol = baseName;
        const name = `${prefix}${baseName}${suffix}`;
        
        return await this.compileAndDeployContract("MemeToken", name, symbol);
    }

    async mintNFT(contract, price) {
        return await withRetry(async () => {
            try {
                // Prepare transaction data
                const nftData = contract.methods.mint().encodeABI();
                
                // Estimate gas using our custom estimator
                const gasEstimator = new GasEstimator(this.web3);
                const gasSettings = await gasEstimator.getGasForTransaction({
                    from: this.address,
                    to: contract.options.address,
                    data: nftData,
                    value: this.web3.utils.toHex(price)
                });
                
                // Create and sign transaction
                const tx = await this.web3.eth.accounts.signTransaction(
                    {
                        from: this.address,
                        to: contract.options.address,
                        data: nftData,
                        value: this.web3.utils.toHex(price),
                        ...gasSettings
                    },
                    this.account.privateKey
                );
                
                // Send signed transaction
                const receipt = await this.web3.eth.sendSignedTransaction(tx.rawTransaction);
                Logger.success(this.address, `NFT minted in transaction: ${receipt.transactionHash}`);
                
                return receipt;
            } catch (error) {
                Logger.error(this.address, `Failed to mint NFT: ${error.message}`);
                throw error;
            }
        });
    }

    async deployNFT() {
        const collections = [
            { name: 'Cosmic Cats', symbol: 'CCAT' },
            { name: 'Pixel Pirates', symbol: 'PIXA' },
            { name: 'Mystic Monsters', symbol: 'MMON' },
            { name: 'Digital Dragons', symbol: 'DDRG' },
            { name: 'Space Samurai', symbol: 'SAMU' },
            { name: 'Cyber Chiefs', symbol: 'CYBR' },
            { name: 'Meta Monks', symbol: 'MONK' },
            { name: 'Neon Knights', symbol: 'NKNT' },
            { name: 'Astral Avatars', symbol: 'ASTR' },
            { name: 'Blockchain Brawlers', symbol: 'BRWL' },
            { name: 'Crypto Champions', symbol: 'CHMP' },
            { name: 'Desert Druids', symbol: 'DRUID' },
            { name: 'Electric Elves', symbol: 'ELVE' },
            { name: 'Forgotten Foxes', symbol: 'FOXS' },
            { name: 'Galactic Gorillas', symbol: 'GAPE' },
            { name: 'Haunted Heroes', symbol: 'HHRO' },
            { name: 'Interstellar Insects', symbol: 'INST' },
            { name: 'Jungle Jaguars', symbol: 'JAGS' },
            { name: 'Kinetic Koalas', symbol: 'KOAS' },
            { name: 'Lunar Lions', symbol: 'LION' },
            { name: 'Mythical Mermaids', symbol: 'MERM' },
            { name: 'Nebula Narwhals', symbol: 'NRWL' },
            { name: 'Oceanic Orcas', symbol: 'ORCA' },
            { name: 'Primal Panthers', symbol: 'PNTR' },
            { name: 'Quantum Qubits', symbol: 'QBIT' },
            { name: 'Renaissance Robots', symbol: 'ROBO' },
            { name: 'Savage Sharks', symbol: 'SHRK' },
            { name: 'Techno Tigers', symbol: 'TIGR' },
            { name: 'United Unicorns', symbol: 'UNCO' },
            { name: 'Virtual Vikings', symbol: 'VKNG' },
            { name: 'Wizard Wolves', symbol: 'WOLF' },
            { name: 'Xenial Xenomorphs', symbol: 'XENO' },
            { name: 'Yin Yang Yetis', symbol: 'YETI' },
            { name: 'Zealous Zebras', symbol: 'ZBRA' },
            { name: 'Alien Astronauts', symbol: 'ALIEN' },
            { name: 'Bizarre Bats', symbol: 'BATS' },
            { name: 'Celestial Centaurs', symbol: 'CENT' },
            { name: 'Divine Dinos', symbol: 'DINO' },
            { name: 'Emerald Eagles', symbol: 'EGLE' }
        ];

        const collection = collections[Math.floor(Math.random() * collections.length)];
        const baseURI = `https://api.nft.com/${collection.symbol.toLowerCase()}/`;
        const maxSupply = 1000 + Math.floor(Math.random() * 9000);
        const price = this.web3.utils.toWei('0.00001', 'ether');

        const contract = await this.compileAndDeployContract(
            "NFT",
            collection.name,
            collection.symbol,
            baseURI,
            maxSupply,
            price
        );

        // Mint process with retry
        const mintCount = Math.floor(Math.random() * 5) + 1;
        Logger.log(this.address, `Minting ${mintCount} NFTs...`);

        for(let i = 0; i < mintCount; i++) {
            try {
                const receipt = await this.mintNFT(contract, price);
                Logger.success(this.address, `Minted NFT #${i + 1}`);
            } catch (error) {
                if (isInsufficientFundsError(error)) {
                    Logger.error(this.address, `Insufficient funds for NFT minting: ${cleanErrorMessage(error)}`);
                    break;
                }
                Logger.error(this.address, `NFT minting failed: ${cleanErrorMessage(error)}`);
            }
            
            const delay = Math.floor(Math.random() * 5000) + 2000;
            await setTimeout(delay);
        }

        return contract;
    }
}

// Main Bot Class using Web3
class SomniaBot {
    constructor() {
        this.web3 = web3;
    }

    async claimFaucet(address, proxy) {
        return await withRetry(async () => {
            const proxyAgent = new HttpsProxyAgent(`http://${proxy}`);
            try {
                const response = await axios.post('https://testnet.somnia.network/api/faucet',
                    { address: address },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        httpsAgent: proxyAgent
                    }
                );
                Logger.success(address, `Faucet claimed: ${response.data.data.hash}`);
            } catch (error) {
                if (error.response?.status === 429) {
                    Logger.log(address, 'Faucet cooldown active');
                } else {
                    throw error;
                }
            }
        });
    }

    async checkBalance(address) {
        return await withRetry(async () => {
            const balance = await this.web3.eth.getBalance(address);
            return this.web3.utils.fromWei(balance, 'ether');
        });
    }

    async transferToTeam(deployer) {
        const amount = this.web3.utils.toWei(config.transfers.amount, 'ether');
        const gasEstimator = new GasEstimator(this.web3);
        
        for (const teamWallet of TEAM_WALLETS) {
            await withRetry(async () => {
                // Create transaction data
                const txData = {
                    from: deployer.address,
                    to: teamWallet,
                    value: this.web3.utils.toHex(amount)
                };
                
                // Get gas settings
                const gasSettings = await gasEstimator.getGasForTransaction(txData);
                
                // Sign transaction
                const tx = await this.web3.eth.accounts.signTransaction(
                    {
                        ...txData,
                        ...gasSettings
                    },
                    deployer.account.privateKey
                );
                
                // Send signed transaction
                const receipt = await this.web3.eth.sendSignedTransaction(tx.rawTransaction);
                
                Logger.success(deployer.address, `Transferred to ${teamWallet}: ${receipt.transactionHash}`);
            });
            
            await this.randomDelay();
        }
    }

    async randomDelay() {
        const delay = Math.floor(Math.random() * (config.delays.max - config.delays.min + 1) + config.delays.min);
        await setTimeout(delay);
    }

    async processWallet(privateKey, proxy) {
        try {
            // Create deployer with the private key
            const deployer = new ContractDeployer(privateKey);
            
            Logger.log(deployer.address, `==== Starting wallet processing ====`);
            
            // Check balance first
            try {
                const balance = await this.checkBalance(deployer.address);
                Logger.log(deployer.address, `Current balance: ${balance} ETH`);

                // Attempt faucet if enabled in config
                if (config.features.claimFaucet) {
                    Logger.log(deployer.address, 'Faucet claiming is enabled, attempting to claim');
                    try {
                        await this.claimFaucet(deployer.address, proxy);
                        await this.randomDelay();
                        const newBalance = await this.checkBalance(deployer.address);
                        Logger.log(deployer.address, `Balance after faucet attempt: ${newBalance} ETH`);
                    } catch (error) {
                        if (error.response?.status === 429) {
                            Logger.log(deployer.address, 'Faucet cooldown active');
                        } else {
                            Logger.error(deployer.address, `Faucet claim failed: ${cleanErrorMessage(error)}`);
                        }
                    }
                } else {
                    Logger.log(deployer.address, 'Faucet claiming is disabled in config');
                }

                // Recheck balance before proceeding
                const currentBalance = await this.checkBalance(deployer.address);
                if (parseFloat(currentBalance) < 0.01) {
                    Logger.log(deployer.address, `Balance below threshold (0.01 ETH)`);
                    Logger.log(deployer.address, `Skipping operations for this wallet`);
                    Logger.log(deployer.address, `==== Wallet processing completed ====\n`);
                    return;
                }

                Logger.log(deployer.address, `Balance sufficient, proceeding with operations`);

                // Deploy contracts if enabled
                if (config.features.deployContracts) {
                    Logger.log(deployer.address, `Starting contract deployments`);
                    
                    // Deploy ConfidentialERC20
                    for (let i = 0; i < config.deployments.confidentialERC20Count; i++) {
                        try {
                            Logger.log(deployer.address, `Attempting ConfidentialERC20 deployment ${i + 1}/${config.deployments.confidentialERC20Count}`);
                            await deployer.deployConfidentialERC20();
                            await this.randomDelay();
                        } catch (error) {
                            if (isInsufficientFundsError(error)) {
                                Logger.error(deployer.address, `Insufficient funds for deployment: ${cleanErrorMessage(error)}`);
                                break;
                            }
                            Logger.error(deployer.address, `Deployment failed: ${cleanErrorMessage(error)}`);
                        }
                    }

                    // Deploy NFTs
                    for (let i = 0; i < config.deployments.nftCount; i++) {
                        try {
                            Logger.log(deployer.address, `Attempting NFT deployment ${i + 1}/${config.deployments.nftCount}`);
                            await deployer.deployNFT();
                            await this.randomDelay();
                        } catch (error) {
                            if (isInsufficientFundsError(error)) {
                                Logger.error(deployer.address, `Insufficient funds for NFT: ${cleanErrorMessage(error)}`);
                                break;
                            }
                            Logger.error(deployer.address, `NFT deployment failed: ${cleanErrorMessage(error)}`);
                        }
                    }

                    // Deploy MemeTokens
                    for (let i = 0; i < config.deployments.memeTokenCount; i++) {
                        try {
                            Logger.log(deployer.address, `Attempting MemeToken deployment ${i + 1}/${config.deployments.memeTokenCount}`);
                            await deployer.deployMemeToken();
                            await this.randomDelay();
                        } catch (error) {
                            if (isInsufficientFundsError(error)) {
                                Logger.error(deployer.address, `Insufficient funds for MemeToken: ${cleanErrorMessage(error)}`);
                                break;
                            }
                            Logger.error(deployer.address, `MemeToken deployment failed: ${cleanErrorMessage(error)}`);
                        }
                    }
                } else {
                    Logger.log(deployer.address, 'Contract deployments are disabled in config');
                }

                // Transfer to team if enabled
                if (config.features.transferToTeam) {
                    Logger.log(deployer.address, `Starting team transfers`);
                    try {
                        await this.transferToTeam(deployer);
                        await this.randomDelay();
                    } catch (error) {
                        Logger.error(deployer.address, `Team transfer failed: ${cleanErrorMessage(error)}`);
                    }
                } else {
                    Logger.log(deployer.address, 'Team transfers are disabled in config');
                }

            } catch (error) {
                Logger.error(deployer.address, `Wallet processing error: ${cleanErrorMessage(error)}`);
            }

            Logger.log(deployer.address, `==== Wallet processing completed ====\n`);

        } catch (error) {
            Logger.error('Bot', `Critical error processing wallet: ${cleanErrorMessage(error)}\n`);
        }
    }

    async start() {
        while (true) {
            try {
                Logger.log('Bot', '======= Starting new cycle =======');
                
                for (let i = 0; i < privateKeys.length; i++) {
                    Logger.log('Bot', `Processing wallet ${i + 1}/${privateKeys.length}`);
                    try {
                        const proxy = proxies[i] || proxies[0]; // Fallback to first proxy if not enough
                        await this.processWallet(privateKeys[i], proxy);
                    } catch (error) {
                        Logger.error('Bot', `Failed processing wallet ${i + 1}, moving to next wallet: ${error.message}`);
                    }
                    await this.randomDelay();
                }

                Logger.log('Bot', '======= Cycle completed =======');
                Logger.log('Bot', 'Waiting 25 hours before next cycle\n');
                await setTimeout(25 * 60 * 60 * 1000);
            } catch (error) {
                Logger.error('Bot', `Cycle failed: ${error.message}`);
                await setTimeout(60000);
            }
        }
    }
}

// Start bot
const bot = new SomniaBot();
bot.start().catch(console.error);

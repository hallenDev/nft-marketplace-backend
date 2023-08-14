import { ethers } from "ethers";

const supportChainId = 4;
const RPCS = {
    4: "https://eth-rinkeby.alchemyapi.io/v2/Kc6kXv6BEXbQ7zUa5QwE5Xk9hIE3KVbH",
    250: "https://rough-dark-violet.fantom.quiknode.pro/c98cc970e3148d509e4b106b5e2e1860f019b838/",
    4002: "https://rpc.testnet.fantom.network",
    43114: "https://api.avax.network/ext/bc/C/rpc",
    43113: "https://api.avax-test.network/ext/bc/C/rpc",
}

const providers = {
    4: new ethers.providers.JsonRpcProvider(RPCS[4]),
    250: new ethers.providers.JsonRpcProvider(RPCS[250]),
    4002: new ethers.providers.JsonRpcProvider(RPCS[4002]),
    43114: new ethers.providers.JsonRpcProvider(RPCS[43114]),
    43113: new ethers.providers.JsonRpcProvider(RPCS[43113])
}

/**
 * JWT config.
 */
export const jwt_config = {
    algorithms: ['HS256'],
    secret: 'TIAHX7DyZNeMQmr4'
};

export const morlias_config = {
    serverUrl: 'https://iwsmtvg6erwl.usemoralis.com:2053/server',
    appId: 'JbYcOtXWU0v6lyZZgbgmcpRSsaV1sMEm9ETnSz9m',
    masterKey: 'epjslpQWSl7IfLDkBm1v1rIHLYIz4zFtOMIWUapi',
    apiKey: "iMtxzUcYaFbnsCqR40WZLmCP3NLwKezDa549OW2KChVQJKdYWwL8AP1TM5oGfUy4",
    network: "rinkeby",
    providerUrl: "wss://eth-rinkeby.alchemyapi.io/v2/Kc6kXv6BEXbQ7zUa5QwE5Xk9hIE3KVbH",
    xApiKey: "MsMPBQgzy7nZ1KwKV3ECT0YLPpJJnjM0grsUGfqRfGdwW9wWN4GrZaX34Ae2fcp4"
};

export const pinata_config = {
    apiKey: "33c52f50f2cc036ddf9f",
    apiSecret: "72f52478c2411efe538b643d00217dde0758ff1f873beda3ee6b38ba3b1d8817",
    accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJmZGNjNzNmNi0xMTMwLTQ4ZDYtYTA4OC05Mjk1NjdhOTFmZjciLCJlbWFpbCI6ImluZm9Adm94ZWx4bmV0d29yay5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJpZCI6IkZSQTEiLCJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MX1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlfSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiMzNjNTJmNTBmMmNjMDM2ZGRmOWYiLCJzY29wZWRLZXlTZWNyZXQiOiI3MmY1MjQ3OGMyNDExZWZlNTM4YjY0M2QwMDIxN2RkZTA3NThmZjFmODczYmVkYTNlZTZiMzhiYTNiMWQ4ODE3IiwiaWF0IjoxNjQ1MDkwMjg3fQ.rJEHNXqEbDDVHfcAb-YF2rhghJQYsjeD6qRgN5xHcgk",
}

export const APP_URL = 'http://44.202.211.248:3001';

//ethereum mainnet
export const VOXELX_CONTRACT_ADDR = '0x16CC8367055aE7e9157DBcB9d86Fd6CE82522b31';
export const VOXELX_EXCHANGE_ADDR = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
//

export const ETHERSCAN_API_KEY = 'D2I9Y535K31QTD6RG3FAY7DMZ833S8CBHM';

// export const MARKETPLACE_CONTRACT_ADDR = '0x9f61bcc7EEba9Ba6185057DA6417BE157aa319Ce';

export const CONTRACT = {
    'MARKETPLACE_CONTRACT_ADDR': '0xC9dB3b61eB85834Cb5064D52E5cd1dCa35C71b1C',
    'VXL_TOKEN_ADDR': '0x73a72ffe2a551399cbcd89751fd7fe08cc39e368'
};

export const SK_COLLECTIONS = [
    '0xbaE91591180E525af4796F7256BEa3946C0D6eB3',
    '0x92d68627c2CF44eBD1D1BB0901f414B82a7ba098'
];

export const AUCTION_CONFIG = {
    'SEVEN': 604800,
    'FIVE': 432000
};

export const BAN_PERIOD = [
    604800, // 7days
    2592000,  // 30 days
    7776000, // 90 days
    31536000 // 365 days - 1 year
];

export const SEND_GRID = {
    'API_KEY': 'SG.RCuc0K8aRsSyr_FqBLZDQQ.7_72bMF2_DLmL7WCC4sRNFBrLXL9mo_0hs_SeIEGsF4',
    'EMAIL': 'noreply@superkluster.io'
}

export const SOCKET_SERVER_URI = 'http://3.229.85.229:5001/Socket_Api';

export const provider = providers[supportChainId];

export const REDIS_HOST = 'redis://127.0.0.1:6379';

export const REDIS_CONFIG = {
    HOST: 'redis://127.0.0.1:6379',
    TXN_DB: 1,
    BLOCKNUMBER_DB: 2
};
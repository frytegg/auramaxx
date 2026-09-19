// Generated from contracts/out/Auramaxx.sol/Auramaxx.json — do not edit by hand.
export const AURAMAXX_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "_relayer",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "receive",
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "BUDGET",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "DOWN",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "THRESHOLD_PCT",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "TICKS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "UP",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "bettorCount",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "cannotTrade",
  "inputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "commitBatch",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "entries",
    "type": "tuple[]",
    "internalType": "struct Auramaxx.Entry[]",
    "components": [
     {
      "name": "player",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "side",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "stake",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "nonce",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "sig",
      "type": "bytes",
      "internalType": "bytes"
     }
    ]
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "faucetReserve",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "freeze",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "getPlayers",
  "inputs": [
   {
    "name": "from",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "to",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [
   {
    "name": "addrs",
    "type": "address[]",
    "internalType": "address[]"
   },
   {
    "name": "names",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
   },
   {
    "name": "avatars",
    "type": "uint8[]",
    "internalType": "uint8[]"
   },
   {
    "name": "profits",
    "type": "uint96[]",
    "internalType": "uint96[]"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getRound",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "round",
    "type": "tuple",
    "internalType": "struct Auramaxx.Round",
    "components": [
     {
      "name": "kind",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "status",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "winner",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "hasWinner",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "freezeAtBlock",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "poolUp",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "poolDown",
      "type": "uint128",
      "internalType": "uint128"
     },
     {
      "name": "threshold",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "settledCount",
      "type": "uint32",
      "internalType": "uint32"
     }
    ]
   },
   {
    "name": "nBettors",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "idOf",
  "inputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "joinBatch",
  "inputs": [
   {
    "name": "who",
    "type": "address[]",
    "internalType": "address[]"
   },
   {
    "name": "names",
    "type": "bytes32[]",
    "internalType": "bytes32[]"
   },
   {
    "name": "avatars",
    "type": "uint8[]",
    "internalType": "uint8[]"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "mult",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "upX100",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "downX100",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "openRound",
  "inputs": [
   {
    "name": "kind",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "freezeAtBlock",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "operator",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "paidUpTo",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "payoutMon",
  "inputs": [
   {
    "name": "from",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "to",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "playerCount",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "players",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "addr",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "profit",
    "type": "uint96",
    "internalType": "uint96"
   },
   {
    "name": "name",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "avatar",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "nonce",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "relayer",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "resolveByCount",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "count",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "resolveByPrice",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "openPrice",
    "type": "int256",
    "internalType": "int256"
   },
   {
    "name": "closePrice",
    "type": "int256",
    "internalType": "int256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "resolveChunk",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "from",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "to",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "roundCount",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "rounds",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "kind",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "status",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "winner",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "hasWinner",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "freezeAtBlock",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "poolUp",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "poolDown",
    "type": "uint128",
    "internalType": "uint128"
   },
   {
    "name": "threshold",
    "type": "uint32",
    "internalType": "uint32"
   },
   {
    "name": "settledCount",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "setRelayer",
  "inputs": [
   {
    "name": "a",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "sideOf",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "stakeOf",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint128",
    "internalType": "uint128"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "event",
  "name": "Bet",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "id",
    "type": "uint16",
    "indexed": true,
    "internalType": "uint16"
   },
   {
    "name": "side",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "stake",
    "type": "uint128",
    "indexed": false,
    "internalType": "uint128"
   },
   {
    "name": "total",
    "type": "uint128",
    "indexed": false,
    "internalType": "uint128"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Joined",
  "inputs": [
   {
    "name": "id",
    "type": "uint16",
    "indexed": true,
    "internalType": "uint16"
   },
   {
    "name": "addr",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "name",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   },
   {
    "name": "avatar",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "MonPaid",
  "inputs": [
   {
    "name": "id",
    "type": "uint16",
    "indexed": true,
    "internalType": "uint16"
   },
   {
    "name": "to",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Paid",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "id",
    "type": "uint16",
    "indexed": true,
    "internalType": "uint16"
   },
   {
    "name": "payout",
    "type": "uint128",
    "indexed": false,
    "internalType": "uint128"
   },
   {
    "name": "profit",
    "type": "uint96",
    "indexed": false,
    "internalType": "uint96"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Resolved",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "winner",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "total",
    "type": "uint128",
    "indexed": false,
    "internalType": "uint128"
   },
   {
    "name": "winners",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "refunded",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RoundFrozen",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "poolUp",
    "type": "uint128",
    "indexed": false,
    "internalType": "uint128"
   },
   {
    "name": "poolDown",
    "type": "uint128",
    "indexed": false,
    "internalType": "uint128"
   },
   {
    "name": "threshold",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RoundOpened",
  "inputs": [
   {
    "name": "roundId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "kind",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "freezeAtBlock",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "BadState",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotOperator",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotRelayer",
  "inputs": []
 }
] as const

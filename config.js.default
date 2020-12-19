const ip = require('ip')
module.exports = {
  'tx_max_concurrency': 100,
  'sync_height': 0,
  'rpc': {
    'protocol': 'http',
    'user': 'cc',
    'pass': 'cc',
    'host': '127.0.0.1',
    'port': '18332',
    'max_concurrency': 30
  },
  'db': {
    'name': 'oracledb',
    'url': 'mongodb://localhost:27017',
    'max_concurrency': 30,
    'index': {
      'tx': {
        'keys': [
          'confirmed'
        ]
      },
      'utxo': {
        'keys': [
          'tokenID',
          'txid',
          'address',
          //(address, tokenID)
        ]
      }
    }
  },
  'zmq': {
    'incoming': {
      'host': '127.0.0.1',
      'port': '28000'
    }
  },
  'logger': {
    'level': 'debug'
  }
}

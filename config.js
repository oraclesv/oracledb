module.exports = {
  'tx_max_concurrency': 100,
  'sync_height': 666226,
  'rpc': {
    'protocol': 'http',
    'user': 'bitcoin',
    'pass': 'bitcoin',
    'host': '127.0.0.1',
    'port': '9876',
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
      'port': '29000'
    }
  },
  'logger': {
    'level': 'info'
  }
}

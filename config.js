const ip = require('ip')
module.exports = {
  'rpc': {
    'protocol': 'http',
    'user': 'cc',
    'pass': 'cc',
    'host': '127.0.0.1',
    'port': '18332',
    'limit': 15
  },
  'db': {
    'name': 'bitdb',
    'url': 'mongodb://localhost:27017',
    'index': {
      'tx': {
        'keys': [
          'hash'
        ]
      },
      'utxo': {
        'keys': [
          'tokenid',
          'txid',
        ]
      }
    }
  },
  'zmq': {
    'incoming': {
      'host': '127.0.0.1',
      'port': '28000'
    }
  }
}

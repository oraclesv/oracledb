const Cache = module.exports

let data = {}

Cache.data = function() {
    return data
}

Cache.add = function(key, value) {
  data[key] = value
}

Cache.del = function(key) {
  if (data[key] !== undefined) {
    delete data[key]
    return true
  } 
  return false
}

Cache.get = function(key) {
  return data[key]
}

Cache.has = function(key) {
  return data[key] !== undefined
}

Cache.clear = function() {
    data = {}
}

Cache.getUtxoKey = function(txid, index) {
    return txid + index
}

Cache.addUtxo = function(txid, index, value) {
    const key = Cache.getUtxoKey(txid, index)
    return Cache.add(key, value)
}

Cache.delUtxo = function(txid, index) {
    const key = Cache.getUtxoKey(txid, index)
    return Cache.del(key)
}

Cache.getUtxo = function(txid, index) {
    const key = Cache.getUtxoKey(txid, index)
    return Cache.get(key)
}

Cache.hasUtxo = function(txid, index) {
    const key = Cache.getUtxoKey(txid, index)
    return Cache.has(key)
}
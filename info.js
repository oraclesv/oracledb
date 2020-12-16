const Filter = require('./bitdb.json')
const Db = require('./db')
/**
* Return the last synchronized checkpoint
*/

let tip = Filter.from

const checkpoint = function() {
  return new Promise(async function(resolve, reject) {
    resolve(tip)
  })
}
const updateTip = function(index) {
  return new Promise(function(resolve, reject) {
    let res = await Db.info.updateHeight(index)
    console.log('updateTip: res:', res)
    //TODO: handle failed
    tip = index
    resolve()
  })
}
module.exports = {
  checkpoint: checkpoint,
  updateTip: updateTip,
}

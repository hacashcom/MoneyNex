'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ctx = vm.createContext({
    JSON_parse: JSON.parse, explorer_url: 'https://explorer.hacash.org', AbortController,
    setTimeout: (callback, ms) => setTimeout(callback, ms === 5000 ? 100 : ms), clearTimeout,
})
for (const file of ['moneynx_sdk_facade.js', 'assetamt.js', 'msglayout.js', 'actionfacts.js', 'actiondisplay.js', 'actionrender.js', 'moneynx_txview.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx)
}
const scope = (start, end, path = '0') => ({ kind: '1042', path, json: JSON.stringify({kind:1042,start,end}), description:'Limit height range' })
const review = { main: '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9', actions: [scope(100,110)] }
let calls = [], status = {chain_id:7,block_target_seconds:30}, block = {height:100,timestamp:1700000000}
ctx.fetch = async (url, options) => {
    assert.equal(options.cache, 'no-store')
    calls.push(url)
    return {ok:true,json:async()=>url.endsWith('/status') ? status : url.includes('/intro?') ? block : {ret:0,height:100}}
}

;(async () => {
    const original = JSON.stringify(review)
    let clock = await ctx.mnx_height_clock_load(review,{id:7,rpc:'https://chain7.example/'})
    assert(clock.available && clock.chain_id_verified)
    assert.equal(clock.block_target_seconds,30)
    assert.deepEqual(calls, ['https://chain7.example/status','https://chain7.example/query/latest','https://chain7.example/query/block/intro?height=100'])
    assert.equal(ctx.mnx_height_estimated_time(110,clock),'2023-11-14 22:18 UTC')
    assert.equal(ctx.mnx_height_estimated_time(90,clock),'2023-11-14 22:08 UTC')
    let line = ctx.parseTxDesc(review,{height_clock:clock})[0]
    assert(line.includes('100 ') && line.includes('(est. 2023-11-14 22:13 UTC)'))
    assert(line.includes('110 ') && line.includes('(est. 2023-11-14 22:18 UTC)'))
    assert(!line.includes('Limit height range'))
    assert.equal(JSON.stringify(review),original)
    line = ctx.mnx_height_scope_html(scope(100,0),clock)
    assert(line.endsWith('to Unlimited'))
    assert.equal((line.match(/est\./g)||[]).length,1)
    assert.equal(ctx.mnx_height_estimated_time(1099511627775,clock),null)
    assert.equal(ctx.mnx_height_scope_facts(scope('1x',100)),null)
    assert.equal(ctx.mnx_height_scope_facts(scope(true,100)),null)
    assert.equal(ctx.mnx_height_scope_facts({kind:1042,json:'{bad'}),null)
    line = ctx.parseTxDesc({actions:[{kind:25,description:'Select one action',children:[scope(100,110,'0/0')]}]},{height_clock:clock})[0]
    assert(line.includes('[0/0] Height scope') && line.includes('22:18 UTC'))

    status = {height:100}
    clock = await ctx.mnx_height_clock_load(review,{id:0,rpc:'https://mainnet.example'})
    assert(clock.available && !clock.chain_id_verified)
    assert.equal(clock.block_target_seconds,300)
    assert.equal(clock.interval_source,'mainnet-protocol')
    assert.equal(ctx.mnx_height_estimated_time(110,clock),'2023-11-14 23:03 UTC')
    calls = []
    clock = await ctx.mnx_height_clock_load(review,{id:7,rpc:'https://chain7.example'})
    assert(!clock.available && clock.reason.includes('target block interval'))
    assert.equal(calls.length,1)
    status = {chain_id:8,block_target_seconds:30}
    clock = await ctx.mnx_height_clock_load(review,{id:7,rpc:'https://chain7.example'})
    assert(!clock.available && clock.reason.includes('chain ID'))
    assert(!ctx.mnx_height_scope_html(scope(100,110),clock).includes('time unavailable'), 'no clock renders bare heights only')
    status = {chain_id:7,block_target_seconds:0}
    clock = await ctx.mnx_height_clock_load(review,{id:7,rpc:'https://chain7.example'})
    assert(!clock.available && clock.reason.includes('interval is invalid'))
    status = {chain_id:7,block_target_seconds:30}
    block = {height:101,timestamp:1700000000}
    clock = await ctx.mnx_height_clock_load(review,{id:7,rpc:'https://chain7.example'})
    assert(!clock.available && clock.reason.includes('mismatched'))
    calls = []
    assert.equal(await ctx.mnx_height_clock_load({actions:[]},{id:7,rpc:'https://chain7.example'}),null)
    assert.equal(calls.length,0)
    ctx.fetch = (url,{signal}) => new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
    clock = await ctx.mnx_height_clock_load(review,{id:7,rpc:'https://chain7.example'})
    assert(!clock.available && clock.reason.includes('timed out'))
    console.log('heightclock tests ok')
})().catch(error=>{console.error(error);process.exitCode=1})

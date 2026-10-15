'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const clone = data => JSON.parse(JSON.stringify(data))
const storage = {
    asset_meta_cache: { '5': {decimal:8,ticket:'LEGACY',name:''} },
    asset_meta_cache_v2_0: { '5': {decimal:6,ticket:'A',name:''} },
}
let calls = [], releaseSlow, slowStarted
const slowRequest = new Promise(resolve=>{slowStarted=resolve})
const ctx = vm.createContext({
    current_chain:{id:0,rpc:'https://chain0.example'},
    chrome:{storage:{local:{
        get:async key=>clone({[key]:storage[key] || {}}),
        set:async values=>Object.assign(storage,clone(values)),
    }}},
    do_fetch_get:async url=>{
        calls.push(url)
        if(url.endsWith('serial=11')){
            slowStarted()
            return new Promise(resolve=>{releaseSlow=()=>resolve({asset:{decimal:4,ticket:'A11'}})})
        }
        return {asset:{decimal:2,ticket:'B',name:''}}
    },
})
ctx.stoReadCurrentChain = async()=>({...ctx.current_chain})
vm.runInContext(fs.readFileSync(path.join(__dirname,'assetamt.js'),'utf8'),ctx)

;(async()=>{
    await ctx.mnx_asset_meta_load()
    assert.equal(ctx.mnx_asset_amount_text('5000000','5').text,'5')
    assert.equal(ctx.mnx_asset_meta_get('5').ticket,'A')
    ctx.current_chain = {id:7,rpc:'https://chain7.example/'}
    assert.equal(ctx.mnx_asset_meta_get('5'),null)
    await ctx.mnx_asset_meta_ensure(['5'])
    assert.equal(ctx.mnx_asset_amount_text('5000000','5').text,'50000')
    assert.equal(ctx.mnx_asset_meta_get('5').ticket,'B')
    assert.deepEqual(calls,['https://chain7.example/query/asset?serial=5'])
    assert.equal(storage.asset_meta_cache_v2_0['5'].ticket,'A')
    assert.equal(storage.asset_meta_cache_v2_7['5'].ticket,'B')
    assert.equal(storage.asset_meta_cache['5'].ticket,'LEGACY')

    ctx.current_chain = {id:0,rpc:'https://chain0.example'}
    const oldRequest = ctx.mnx_asset_meta_ensure(['11'])
    await slowRequest
    ctx.current_chain = {id:7,rpc:'https://chain7.example'}
    releaseSlow()
    await oldRequest
    assert.equal(storage.asset_meta_cache_v2_0['11'].ticket,'A11')
    assert.equal(storage.asset_meta_cache_v2_7['11'],undefined)
    assert.equal(ctx.mnx_asset_meta_get('11'),null)
    assert.equal(ctx.mnx_asset_meta_get('5').ticket,'B')
    assert.equal(calls[calls.length-1],'https://chain0.example/query/asset?serial=11')

    // A balance response carries the context captured before its RPC request.
    await ctx.mnx_asset_meta_put_list([{serial:'12',decimal:3,ticket:'A12'}],{chain_id:0,rpc:'https://chain0.example'})
    assert.equal(ctx.mnx_asset_meta_get('12'),null)
    assert.equal(storage.asset_meta_cache_v2_0['12'].ticket,'A12')
    ctx.current_chain = {id:0,rpc:'https://chain0.example'}
    assert.equal(ctx.mnx_asset_meta_get('12').ticket,'A12')

    ctx.mnx_asset_meta_mem = null
    ctx.current_chain = {id:7,rpc:'https://chain7.example'}
    await ctx.mnx_asset_meta_load()
    assert.equal(ctx.mnx_asset_meta_get('5').ticket,'B')
    ctx.current_chain = {id:9,rpc:'https://chain9.example'}
    await ctx.mnx_asset_meta_load()
    assert.equal(ctx.mnx_asset_meta_get('5'),null,'legacy flat metadata must not leak into another chain')
    assert.equal(ctx.mnx_asset_amount_text('5000000','5').known,false)
    assert.equal(ctx.mnx_asset_meta_norm({decimal:'2.5'}),null)
    assert.equal(ctx.mnx_asset_meta_norm({decimal:2.5}),null)
    assert.equal(ctx.mnx_asset_meta_norm({decimal:'2x'}),null)
    ctx.current_chain = {id:-1,rpc:'https://invalid.example'}
    assert.equal(ctx.mnx_asset_meta_get('5'),null)
    assert.deepEqual(clone(await ctx.mnx_asset_meta_ensure(['5'])),{})
    console.log('assetcache tests ok')
})().catch(error=>{console.error(error);process.exitCode=1})

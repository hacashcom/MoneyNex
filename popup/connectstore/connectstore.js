var stokey_connect_domains = 'connect_domains'
, stoAppendConnectDomains = async dmu => {
    dmu = dmu || 'hacash.com'
    let dms = await chrome_storage_local.get(stokey_connect_domains)
    dms = dms[stokey_connect_domains] || []
    if (dms.indexOf(dmu) == -1) {
        dms.unshift(dmu)
        let sto = {}
        sto[stokey_connect_domains] = dms
        await chrome_storage_local.set(sto)
    }
    return dms
}
, stoGetConnectDomains = stoAppendConnectDomains
;

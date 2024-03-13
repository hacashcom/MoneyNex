
// console.log("crypto-util.js !!!")
var C = CryptoJS
, aesps = C.enc.Utf8.parse
, AES_encrypt = (msg, pass) => {
    let iv = aesps(pass)
    return C.AES.encrypt(aesps(msg), iv, { iv }).toString()
}
, AES_decrypt = (ciphertext, pass) => {
    let iv = aesps(pass)
    return C.AES.decrypt(ciphertext, iv, { iv }).toString(C.enc.Utf8)
}

, MD5 = s => C.MD5(s).toString()
, SHA256 = s => C.SHA256(s).toString()


/*
var sss = AES_encrypt("AAAA", "1234")
console.log(sss)
console.log(AES_decrypt(sss, "1234"))
*/



/**
 * fetch
 */
var  _Promise = Promise
, do_fetch_get = (url) => {
    return new _Promise(ok=>{
        fetch(url, {method: 'GET'})
            .then(response => response.json())
            .then(data => {
                // console.log(data);
                ok(data)
            })
            .catch(error => {
                ok({ret: 1, err: error.toString()})
            });
    })
}
, do_fetch_post = async (url, body, headers) => {
    headers = headers || {}
    return new _Promise(ok=>{
        fetch(url, {
            method: 'POST', 
            headers,
            body
        })
            .then(response => response.json())
            .then(data => {
                // console.log(data);
                ok(data)
            })
            .catch(error => {
                ok({ret: 1, err: error.toString()})
            });
    })
}


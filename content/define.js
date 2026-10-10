
/**
 * Create MoneyNex API Element
 */
var optkey_id = "hacash_api_element"
, paramsk = "params"
// B (Phase 3): second hidden div carrying wallet→page events (e.g. 'disconnect').
// A separate element, not an attribute on the api div: the api div's did/data
// attributes hold the last in-flight request's state, and a notification click
// re-firing that stale did could consume a pending dApp callback. Attributes
// here carry {event, detail} only; the click that dispatches them is a no-op
// for the request pipeline.
, optkey_evt_id = "hacash_api_event_element"
;

var JSON_parse = JSON.parse
, JSON_stringify = JSON.stringify
, _setTimeout = setTimeout
;

var $id = (s)=>{
    return document.getElementById(s)
}
, $class = (b, n)=>{
    return (n?b:document).getElementsByClassName(n||b)
}
, $clas = (b, n)=>{
    return $class(b,n)[0]
}
, $attr = (s, k, v)=> {
    return v ? s.setAttribute(k, v) : s.getAttribute(k)
}
, $div = (s) => {
    return document.createElement(s)
}
, $irsd = (s) => {
    document.body.appendChild(s);
}
, $html = (s, h) => {
    return h ? (s.innerHTML = h) : s.innerHTML;
}
, $display_none = (s) => {
    s.style.display = 'none';
}
;

var injectScript = function(file){
    var s = $div('script');
    $attr(s, 'type', 'text/javascript');
    $attr(s, 'src', file);
    $irsd(s);
}

;
  
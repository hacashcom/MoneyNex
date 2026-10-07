


/**
 * API handler registration
 */
// 'wallet' (optkey_check_wallet) is answered by dealAccountApi (account.js): it must
// reply to the content script, never open a popup page. Registering the full list here
// would rely on call order to overwrite that handler — pass the list without it.
dealHandleHacashApiToPopup(optkey_list_to_popup.filter(k => k != optkey_check_wallet))


/**
 * Acccount api
 */
dealAccountApi()


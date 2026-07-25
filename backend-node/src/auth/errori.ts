// Stesso errore per "utente non trovato" e "password errata": la risposta HTTP non
// deve mai lasciar capire se un'email esiste o no (evita enumerazione utenti). Il motivo
// specifico va comunque registrato internamente in tentativi_login_backoffice.
export class ErroreCredenzialiNonValide extends Error {}

export class ErroreUtenteDisattivato extends Error {}

export class ErroreRefreshTokenNonValido extends Error {}

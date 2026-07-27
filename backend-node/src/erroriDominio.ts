// Errori di dominio condivisi dalle repository CRUD del backoffice (distinti da
// auth/errori.ts, che è specifico del flusso di autenticazione). Un'unica definizione
// per classe: i controller in server.ts fanno instanceof contro QUESTE classi, non
// contro copie locali per modulo.
export class ErroreValoreDuplicato extends Error {}
export class ErroreNonTrovato extends Error {}

// Importar PRIMEIRO nos scripts: carrega o .env antes dos módulos que
// leem process.env no momento do import (ex.: src/db).
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env — variáveis devem vir do ambiente
}

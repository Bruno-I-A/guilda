-- Apagar tomador avulso (cadastro errado) passa a valer, mas só sem nota: a
-- action deleteOfficeFeeProfile confere antes, porque a cascata levaria as
-- notas emitidas junto. Com nota, o caminho continua sendo desativar.
GRANT DELETE ON "office_fee_takers" TO guilda_app;

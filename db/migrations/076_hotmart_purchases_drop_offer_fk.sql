-- Robustez do webhook Hotmart: o LOG de compra (hotmart_purchases) não pode falhar
-- porque a oferta não está pré-cadastrada em hotmart_offers. Antes, offer_code tinha
-- FK para hotmart_offers → uma oferta nova (ou o payload de TESTE com offer "test")
-- causava FK violation → process_hotmart_purchase erro → webhook 500 → Hotmart desativa.
-- O valor do serviço continua resolvido por LEFT JOIN com hotmart_offers (quando existe).
-- (Aplicada no remoto via apply_migration.)
alter table portal.hotmart_purchases
  drop constraint if exists hotmart_purchases_offer_code_fkey;

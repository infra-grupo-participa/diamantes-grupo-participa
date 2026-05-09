<?php
/**
 * admin/index.php — server-side guard pro dashboard admin.
 *
 * Antes (admin/index.html estático): qualquer browser anônimo recebia o HTML.
 * Endpoints data exigiam gp_require_admin() server-side, então dados nunca vazaram —
 * mas a estrutura interna ficava exposta.
 *
 * Agora: index.php valida sessão+role ANTES de servir o HTML. Sem session → 401.
 * Sem role=admin → 403. Apenas admin recebe o HTML.
 *
 * Resolve finding D1/D2 (HIGH) do pentest pré-deploy.
 */
declare(strict_types=1);

require_once __DIR__ . '/../api/bootstrap.php';

$user = gp_get_session_user();
if (!$user) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    exit('Sessão inválida. Faça login em /index.html');
}

if (($user['role'] ?? '') !== 'admin') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    exit('Acesso restrito ao admin.');
}

// Audit cross-view: registra acesso ao admin dashboard.
gp_append_audit_log('admin_dashboard_view', [
    'userId' => $user['id'] ?? null,
    'email'  => $user['email'] ?? '',
]);

// Serve o HTML estático (sem expor a sessão JS — auth-guard.js vai validar).
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');
readfile(__DIR__ . '/index.html');

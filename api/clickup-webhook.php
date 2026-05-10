<?php
declare(strict_types=1);

function gp_get_clickup_webhook_secret(): string {
    return trim((string)(getenv('GP_CLICKUP_WEBHOOK_SECRET') ?: getenv('CLICKUP_WEBHOOK_SECRET') ?: ''));
}

function gp_clickup_webhook_signature_valid(string $rawBody, string $signature): bool {
    $secret = gp_get_clickup_webhook_secret();
    if ($secret === '' || $signature === '') {
        return false;
    }
    $expected = hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, trim($signature));
}

function gp_json_response(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    gp_json_response(['ok' => false, 'error' => 'Método não permitido.'], 405);
}

if (gp_get_clickup_webhook_secret() === '') {
    gp_json_response(['ok' => false, 'error' => 'GP_CLICKUP_WEBHOOK_SECRET não configurado.'], 503);
}

$rawBody  = (string)file_get_contents('php://input');
$signature = trim((string)($_SERVER['HTTP_X_SIGNATURE'] ?? ''));

if (!gp_clickup_webhook_signature_valid($rawBody, $signature)) {
    gp_json_response(['ok' => false, 'error' => 'Assinatura inválida.'], 401);
}

// FIX (LOW, pentest 2026-05-09 Finding #10 — replay protection):
// ClickUp envia campo "date" (epoch ms) no payload. Rejeita reqs > 5min.
$payload = json_decode($rawBody, true);
$ts = is_array($payload) && isset($payload['date']) ? (int)($payload['date']) : 0;
if ($ts > 0) {
    $tsSeconds = (int) floor($ts / 1000);
    $skew = abs(time() - $tsSeconds);
    if ($skew > 300) {
        gp_json_response(['ok' => false, 'error' => 'Timestamp fora da janela permitida (replay).'], 401);
    }
}

gp_json_response(['ok' => true, 'received' => true]);

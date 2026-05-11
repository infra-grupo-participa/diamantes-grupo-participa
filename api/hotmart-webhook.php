<?php
declare(strict_types=1);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hm_env(string $key): string {
    return trim((string)(getenv($key) ?: ''));
}

function hm_json(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Hotmart envia o secret como header "X-Hotmart-Hottok"
function hm_signature_valid(string $rawBody, string $hottok): bool {
    $secret = hm_env('GP_HOTMART_WEBHOOK_SECRET');
    if ($secret === '' || $hottok === '') {
        return false;
    }
    return hash_equals($secret, $hottok);
}

function hm_supabase_rpc(string $rpc, array $params): array {
    $url    = rtrim(hm_env('GP_SUPABASE_URL'), '/') . '/rest/v1/rpc/' . $rpc;
    $apiKey = hm_env('GP_SUPABASE_SERVICE_ROLE_KEY');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($params),
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'apikey: ' . $apiKey,
            'Authorization: Bearer ' . $apiKey,
            'Prefer: return=representation',
        ],
        CURLOPT_TIMEOUT        => 10,
    ]);

    $body   = (string)curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['status' => $status, 'body' => $body];
}

// ---------------------------------------------------------------------------
// Validações iniciais
// ---------------------------------------------------------------------------

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    hm_json(['ok' => false, 'error' => 'Método não permitido.'], 405);
}

if (hm_env('GP_HOTMART_WEBHOOK_SECRET') === '') {
    hm_json(['ok' => false, 'error' => 'GP_HOTMART_WEBHOOK_SECRET não configurado.'], 503);
}

if (hm_env('GP_SUPABASE_URL') === '' || hm_env('GP_SUPABASE_SERVICE_ROLE_KEY') === '') {
    hm_json(['ok' => false, 'error' => 'Supabase não configurado.'], 503);
}

$rawBody = (string)file_get_contents('php://input');
$hottok  = trim((string)($_SERVER['HTTP_X_HOTMART_HOTTOK'] ?? ''));

if (!hm_signature_valid($rawBody, $hottok)) {
    hm_json(['ok' => false, 'error' => 'Assinatura inválida.'], 401);
}

$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    hm_json(['ok' => false, 'error' => 'Payload inválido.'], 400);
}

// ---------------------------------------------------------------------------
// Normaliza campos do payload Hotmart
// Estrutura do evento "PURCHASE_APPROVED" / "PURCHASE_COMPLETE" etc.
// ---------------------------------------------------------------------------

$event = strtoupper((string)($payload['event'] ?? ''));

// Eventos que nos interessam
$relevant = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'PURCHASE_CANCELED',
             'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK'];

if (!in_array($event, $relevant, true)) {
    // Evento irrelevante — responde 200 para Hotmart não retentar
    hm_json(['ok' => true, 'skipped' => true, 'event' => $event]);
}

$data = $payload['data'] ?? [];

$txCode      = (string)($data['purchase']['transaction']       ?? '');
$buyerEmail  = strtolower(trim((string)($data['buyer']['email'] ?? '')));
$offerCode   = (string)($data['purchase']['offer']['code']     ?? '');
$serviceName = (string)($data['purchase']['offer']['name']     ?? '');
$amount      = (float)($data['purchase']['price']['value']     ?? 0);
$paymentType = (string)($data['purchase']['payment']['type']   ?? '');
$installTotal = (int)($data['purchase']['payment']['installments_number'] ?? 1);
$installNum   = (int)($data['purchase']['subscription']['subscriber_code'] ?? 0); // fallback
$chargedAtRaw = (string)($data['purchase']['approved_date']    ?? '');

// Hotmart envia datas em epoch ms
$chargedAt = 'now()';
if (is_numeric($chargedAtRaw) && (int)$chargedAtRaw > 0) {
    $chargedAt = date('c', (int)floor((int)$chargedAtRaw / 1000));
} elseif ($chargedAtRaw !== '') {
    $chargedAt = $chargedAtRaw;
}

// Normaliza status
$statusMap = [
    'PURCHASE_APPROVED'   => 'approved',
    'PURCHASE_COMPLETE'   => 'complete',
    'PURCHASE_CANCELED'   => 'canceled',
    'PURCHASE_REFUNDED'   => 'refunded',
    'PURCHASE_CHARGEBACK' => 'chargeback',
];
$status = $statusMap[$event] ?? 'other';

if ($txCode === '' || $buyerEmail === '') {
    hm_json(['ok' => false, 'error' => 'Campos obrigatórios ausentes (transaction/email).'], 422);
}

// ---------------------------------------------------------------------------
// Chama RPC do Supabase
// ---------------------------------------------------------------------------

$result = hm_supabase_rpc('process_hotmart_purchase', [
    'p_transaction_code'   => $txCode,
    'p_buyer_email'        => $buyerEmail,
    'p_offer_code'         => $offerCode,
    'p_service_name'       => $serviceName,
    'p_amount'             => $amount,
    'p_status'             => $status,
    'p_payment_type'       => $paymentType,
    'p_installments_total' => $installTotal,
    'p_installment_number' => $installNum,
    'p_charged_at'         => $chargedAt,
    'p_raw_payload'        => $payload,
]);

if ($result['status'] !== 200) {
    hm_json(['ok' => false, 'error' => 'Erro ao gravar no banco.', 'detail' => $result['body']], 500);
}

$rpcResult = json_decode($result['body'], true);
hm_json(['ok' => true, 'event' => $event, 'result' => $rpcResult]);

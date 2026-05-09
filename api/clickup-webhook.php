<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function gp_clickup_webhook_signature_valid(string $rawBody, string $signature): bool
{
    $secret = gp_get_clickup_webhook_secret();
    // HIGH-4: fail-closed — if the secret is not configured, reject all requests.
    if ($secret === '') {
        return false;
    }
    if ($signature === '') {
        return false;
    }

    $expected = hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, trim($signature));
}

gp_require_method('POST');

$rawBody = file_get_contents('php://input') ?: '';
$signature = (string)($_SERVER['HTTP_X_SIGNATURE'] ?? '');

if (!gp_clickup_webhook_signature_valid($rawBody, $signature)) {
    $secret = gp_get_clickup_webhook_secret();
    if ($secret === '') {
        // Return 503 to signal misconfiguration, not a fake auth failure.
        gp_json_response(['ok' => false, 'error' => 'Webhook não configurado no servidor.'], 503);
    }
    gp_json_response(['ok' => false, 'error' => 'Assinatura inválida.'], 401);
}

$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    gp_json_response(['ok' => false, 'error' => 'Payload inválido.'], 400);
}

$event = (string)($payload['event'] ?? '');
if ($event !== 'taskCommentPosted') {
    gp_json_response(['ok' => true, 'ignored' => true, 'event' => $event]);
}

$webhookKey = gp_extract_clickup_webhook_key($payload);
if (gp_has_notification_marker('clickup-comment', $webhookKey)) {
    gp_json_response(['ok' => true, 'duplicate' => true]);
}

$commentText = gp_extract_clickup_comment_text($payload);
if (
    $commentText === ''
    || gp_is_client_generated_comment($commentText)
    || gp_is_system_generated_comment($commentText)
    || gp_is_read_receipt_comment($commentText)
) {
    gp_json_response(['ok' => true, 'ignored' => true, 'reason' => 'comment_filtered']);
}

$taskId = trim((string)($payload['task_id'] ?? ''));
if ($taskId === '') {
    gp_json_response(['ok' => false, 'error' => 'Task não informada.'], 422);
}

$task = gp_clickup_get_task($taskId);
$clientRelation = gp_resolve_clickup_client($task);
$clientTaskId = trim((string)($clientRelation['taskId'] ?? ''));
$clientSlug = gp_find_client_slug_by_task_id($clientTaskId);

if ($clientSlug === '') {
    gp_json_response(['ok' => true, 'ignored' => true, 'reason' => 'client_not_mapped']);
}

$state = gp_read_state();
$recipients = gp_find_client_user_emails($state, $clientSlug);
if (!$recipients) {
    gp_json_response(['ok' => true, 'ignored' => true, 'reason' => 'no_client_email']);
}

$authorName = gp_extract_clickup_comment_author($payload);
$subject = sprintf('Ei você tem uma mensagem do %s', $authorName);
$portalUrl = gp_get_client_portal_url($clientSlug);
$taskName = trim((string)($task['name'] ?? 'sua solicitação'));
$body = "Ei você tem uma mensagem do {$authorName}.\n\n"
    . "Chamado: {$taskName}\n\n"
    . "Mensagem:\n{$commentText}\n\n"
    . "Entre no sistema para responder e acompanhar a conversa:\n{$portalUrl}\n";

$sent = gp_send_email($recipients, $subject, $body, [
    'event' => 'clickup_comment',
    'taskId' => $taskId,
    'clientSlug' => $clientSlug,
    'author' => $authorName,
]);

if ($sent) {
    gp_claim_notification_marker('clickup-comment', $webhookKey);
    gp_json_response(['ok' => true, 'sent' => true, 'clientSlug' => $clientSlug]);
}

gp_json_response(['ok' => false, 'error' => 'Não foi possível enviar o email da mensagem.'], 500);

<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? 'list';
$admin = gp_require_admin();

try {
    if ($action === 'list') {
        gp_json_response(['ok' => true, 'users' => gp_read_state()['users'], 'sessionUser' => $admin]);
    }

    if ($action === 'update') {
        gp_require_method('POST');
        $payload = gp_request_payload();
        $userId = (string)($payload['userId'] ?? '');
        $patch = is_array($payload['patch'] ?? null) ? $payload['patch'] : [];
        if ($userId === '') {
            throw new RuntimeException('Usuário obrigatório.');
        }

        if (
            $userId === (string)($admin['id'] ?? '')
            && array_key_exists('role', $patch)
            && $patch['role'] !== 'admin'
        ) {
            throw new RuntimeException('Você não pode remover o próprio acesso de admin.');
        }

        $beforeState = gp_read_state();
        $beforeUser = gp_find_user_by_id($beforeState, $userId);
        $updatedUser = gp_update_state(function (array $state) use ($userId, $patch) {
            return gp_update_user_record($state, $userId, $patch);
        });

        if (($_SESSION['gp_user_id'] ?? '') === $updatedUser['id']) {
            gp_set_session_user($updatedUser);
        }

        $becameApprovedClient = $beforeUser
            && ($beforeUser['role'] ?? '') === 'client'
            && ($updatedUser['role'] ?? '') === 'client'
            && ($beforeUser['status'] ?? '') !== 'approved'
            && ($updatedUser['status'] ?? '') === 'approved'
            && !empty($updatedUser['email']);

        if ($becameApprovedClient) {
            $portalUrl = !empty($updatedUser['clientSlug'])
                ? gp_get_client_portal_url((string)$updatedUser['clientSlug'])
                : gp_get_app_base_url();
            gp_send_email(
                [(string)$updatedUser['email']],
                'Seu cadastro foi concluído! Logue no sistema e responda o formulário.',
                "Seu cadastro foi concluído! Logue no sistema " . gp_get_app_base_url() . " e responda o formulário.\n\n"
                . "Acesso direto:\n" . $portalUrl . "\n",
                [
                    'event' => 'user_approved',
                    'userId' => $updatedUser['id'],
                    'clientSlug' => $updatedUser['clientSlug'] ?? '',
                ]
            );
        }

        gp_json_response(['ok' => true, 'user' => $updatedUser]);
    }

    gp_json_response(['ok' => false, 'error' => 'Ação inválida.'], 404);
} catch (RuntimeException $error) {
    gp_json_response(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    gp_json_response(['ok' => false, 'error' => 'Erro interno ao salvar usuário.'], 500);
}

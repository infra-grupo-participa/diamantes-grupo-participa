<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? 'bootstrap';

try {
    if ($action === 'bootstrap') {
        $currentUser = gp_get_session_user();
        $includeUsers = ($_GET['includeUsers'] ?? '0') === '1';

        $payload = [
            'ok' => true,
            'sessionUser' => $currentUser,
            'clientRoutes' => gp_client_routes(),
        ];

        if ($includeUsers && $currentUser && ($currentUser['role'] ?? '') === 'admin') {
            $payload['users'] = gp_read_state()['users'];
        }

        gp_json_response($payload);
    }

    if ($action === 'login') {
        gp_require_method('POST');
        $payload = gp_request_payload();
        $identifier = (string)($payload['identifier'] ?? '');
        $password = (string)($payload['password'] ?? '');
        $state = gp_read_state();
        $user = gp_find_user_by_identifier($state, $identifier);

        if (!$user || (string)($user['password'] ?? '') !== $password) {
            gp_json_response(['ok' => false, 'error' => 'Email ou senha inválidos.'], 422);
        }

        gp_set_session_user($user);
        gp_json_response([
            'ok' => true,
            'user' => $user,
            'status' => $user['role'] === 'admin' ? 'admin' : ($user['status'] ?? 'pending'),
        ]);
    }

    if ($action === 'register') {
        gp_require_method('POST');
        $payload = gp_request_payload();
        $input = gp_validate_registration_input($payload);
        $shouldSetSession = !isset($payload['setSession']) || $payload['setSession'] !== false;

        $createdUser = gp_update_state(function (array $state) use ($input) {
            foreach ($state['users'] as $user) {
                if (gp_normalize_email((string)($user['email'] ?? '')) === $input['email']) {
                    throw new RuntimeException('Já existe um usuário com esse email.');
                }
            }

            $user = gp_normalize_user([
                'id' => 'usr_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 8),
                'name' => $input['name'],
                'email' => $input['email'],
                'password' => $input['password'],
                'documentType' => $input['documentType'],
                'documentValue' => $input['documentValue'],
                'cpf' => $input['documentType'] === 'cpf' ? $input['documentValue'] : '',
                'role' => 'client',
                'status' => 'pending',
                'clientSlug' => '',
                'createdAt' => gp_now_iso(),
                'updatedAt' => gp_now_iso(),
            ]);

            $state['users'][] = $user;
            return [$state, $user];
        });

        if ($shouldSetSession) {
            gp_set_session_user($createdUser);
        }

        gp_json_response(['ok' => true, 'user' => $createdUser]);
    }

    if ($action === 'logout') {
        gp_require_method('POST');
        gp_clear_session();
        gp_json_response(['ok' => true]);
    }

    gp_json_response(['ok' => false, 'error' => 'Ação inválida.'], 404);
} catch (RuntimeException $error) {
    gp_json_response(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    gp_json_response(['ok' => false, 'error' => 'Erro interno na autenticação.'], 500);
}

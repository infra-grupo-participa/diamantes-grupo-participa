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
            'sessionUser' => $currentUser ? gp_public_user($currentUser) : null,
            'clientRoutes' => gp_client_routes(),
        ];

        if ($includeUsers && $currentUser && ($currentUser['role'] ?? '') === 'admin') {
            $payload['users'] = array_map('gp_public_user', gp_read_state()['users']);
        }

        gp_json_response($payload);
    }

    if ($action === 'login') {
        gp_require_method('POST');
        gp_require_csrf_header();
        $payload = gp_request_payload();
        $identifier = (string)($payload['identifier'] ?? '');
        $password = (string)($payload['password'] ?? '');

        gp_check_rate_limit($identifier);

        $state = gp_read_state();
        $user = gp_find_user_by_identifier($state, $identifier);
        $stored = (string)($user['password'] ?? '');
        $valid = $user !== null && gp_verify_password($password, $stored);

        if (!$valid) {
            gp_record_rate_limit_failure($identifier);
            gp_append_audit_log('login_fail', ['identifier' => $identifier, 'ip' => gp_client_ip()]);
            gp_json_response(['ok' => false, 'error' => 'Email ou senha inválidos.'], 422);
        }

        gp_clear_rate_limit($identifier);

        // Transparent upgrade: if stored password is plaintext, re-hash on successful login.
        if (!str_starts_with($stored, '$2')) {
            $user = gp_update_state(function (array $state) use ($user, $password) {
                foreach ($state['users'] as &$u) {
                    if (($u['id'] ?? '') === $user['id']) {
                        $u['password'] = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
                        $u['updatedAt'] = gp_now_iso();
                        $user = $u;
                        break;
                    }
                }
                unset($u);
                return [$state, $user];
            });
        }

        gp_set_session_user($user);
        gp_append_audit_log('login_ok', ['userId' => $user['id'], 'ip' => gp_client_ip()]);
        gp_json_response([
            'ok' => true,
            'user' => gp_public_user($user),
            'status' => $user['role'] === 'admin' ? 'admin' : ($user['status'] ?? 'pending'),
            'csrfToken' => gp_get_csrf_token(),
        ]);
    }

    if ($action === 'register') {
        gp_require_method('POST');
        gp_require_csrf_header();
        $payload = gp_request_payload();
        $input = gp_validate_registration_input($payload);
        $shouldSetSession = !isset($payload['setSession']) || $payload['setSession'] !== false;

        $createdUser = gp_update_state(function (array $state) use ($input) {
            foreach ($state['users'] as $user) {
                if (gp_normalize_email((string)($user['email'] ?? '')) === $input['email']) {
                    // Anti-enumeration: equalise response time with the new-user path (CWE-208).
                    // password_hash at cost=12 (~500ms) prevents timing oracle — result discarded.
                    password_hash($input['password'], PASSWORD_BCRYPT, ['cost' => 12]);
                    return [$state, null];
                }
            }

            $user = gp_normalize_user([
                'id' => 'usr_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 8),
                'name' => $input['name'],
                'email' => $input['email'],
                'password' => password_hash($input['password'], PASSWORD_BCRYPT, ['cost' => 12]),
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

        // $createdUser is null when email already existed (anti-enum: same response).
        if ($createdUser !== null && $shouldSetSession) {
            gp_set_session_user($createdUser);
        }

        $returnUser = $createdUser ?? [
            'id' => '',
            'name' => $input['name'],
            'email' => $input['email'],
            'role' => 'client',
            'status' => 'pending',
        ];

        gp_json_response(['ok' => true, 'user' => gp_public_user($returnUser), 'csrfToken' => gp_get_csrf_token()]);
    }

    if ($action === 'logout') {
        gp_require_method('POST');
        gp_require_csrf_header();
        $loggedUser = gp_get_session_user();
        gp_clear_session();
        if ($loggedUser) {
            gp_append_audit_log('logout', ['userId' => $loggedUser['id'], 'ip' => gp_client_ip()]);
        }
        gp_json_response(['ok' => true]);
    }

    gp_json_response(['ok' => false, 'error' => 'Ação inválida.'], 404);
} catch (RuntimeException $error) {
    gp_json_response(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    gp_json_response(['ok' => false, 'error' => 'Erro interno na autenticação.'], 500);
}

<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

// Idempotent endpoint: returns the CSRF token for the current PHP session.
// Works for both authenticated and unauthenticated sessions — the token is
// always bound to the session, so pre-login calls (e.g. from the login page)
// get a valid token they can use when POSTing credentials.
gp_json_response(['ok' => true, 'csrfToken' => gp_get_csrf_token()]);

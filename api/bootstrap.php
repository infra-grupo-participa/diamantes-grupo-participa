<?php

/**
 * Bootstrap — Fase 2 refactor.
 *
 * Defines GP_* constants, starts the session, requires the Composer autoloader,
 * and exposes the legacy gp_*() function API as thin wrappers that delegate to
 * the PSR-4 classes under src/. All api/*.php endpoints continue to call these
 * functions unchanged — behaviour is bit-for-bit identical.
 */
declare(strict_types=1);

const GP_ROOT = __DIR__ . '/..';
const GP_STORAGE_DIR = __DIR__ . '/storage';
const GP_DATA_DIR = __DIR__ . '/data';
const GP_STATE_FILE = GP_STORAGE_DIR . '/app-state.json';
const GP_NOTIFICATION_LOG_FILE = GP_STORAGE_DIR . '/notification-log.jsonl';
const GP_NOTIFICATION_MARKER_DIR = GP_STORAGE_DIR . '/notification-markers';
const GP_CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';
const GP_CLICKUP_CLIENT_RELATION_FIELD_ID = 'b25022f9-f6a7-44be-8b86-7454fe9fa770';
const GP_AUDIT_LOG_FILE = GP_STORAGE_DIR . '/audit-log.jsonl';
const GP_RATE_LIMIT_FILE = GP_STORAGE_DIR . '/rate-limits.json';

// ── Autoloader ────────────────────────────────────────────────────────────────
// Must be loaded before referencing class constants below.

require_once GP_ROOT . '/vendor/autoload.php';

// Constants that alias class-level values — loaded after autoloader.
const GP_RATE_LIMIT_MAX_FAILURES = \Diamantes\Auth\RateLimiter::MAX_FAILURES;
const GP_RATE_LIMIT_WINDOW_SECONDS = \Diamantes\Auth\RateLimiter::WINDOW_SECONDS;

// ── Session ───────────────────────────────────────────────────────────────────

\Diamantes\Auth\SessionManager::start();

// ═════════════════════════════════════════════════════════════════════════════
// Legacy gp_*() wrappers — each delegates to the corresponding class method.
// api/*.php files call these functions; no endpoint file needs to change.
// ═════════════════════════════════════════════════════════════════════════════

// ── Http ──────────────────────────────────────────────────────────────────────

function gp_now_iso(): string
{
    return \Diamantes\Http\Request::nowIso();
}

function gp_json_response(array $payload, int $status = 200): never
{
    \Diamantes\Http\JsonResponse::send($payload, $status);
}

function gp_raw_response(string $body, int $status = 200, string $contentType = 'application/json; charset=utf-8'): never
{
    \Diamantes\Http\JsonResponse::raw($body, $status, $contentType);
}

function gp_request_payload(): array
{
    return \Diamantes\Http\Request::payload();
}

function gp_require_method(string $expected): void
{
    \Diamantes\Http\Request::requireMethod($expected);
}

function gp_client_ip(): string
{
    return \Diamantes\Http\Request::clientIp();
}

function gp_no_cache_headers(): void
{
    \Diamantes\Http\JsonResponse::noCacheHeaders();
}

// ── Storage ───────────────────────────────────────────────────────────────────

function gp_ensure_storage(): void
{
    \Diamantes\Container::getInstance()->stateRepository()->ensureStorage();
}

function gp_read_json_file(string $path, array $fallback): array
{
    return \Diamantes\Container::getInstance()->stateRepository()->readJsonFile($path, $fallback);
}

function gp_write_json_file(string $path, array $value): void
{
    \Diamantes\Container::getInstance()->stateRepository()->writeJsonFile($path, $value);
}

function gp_append_log_line(string $path, array $value): void
{
    \Diamantes\Container::getInstance()->stateRepository()->appendLogLine($path, $value);
}

function gp_read_secret_text_file(string $path): string
{
    return \Diamantes\Storage\StateRepository::readSecretTextFile($path);
}

// ── State management ──────────────────────────────────────────────────────────

function gp_read_state(): array
{
    return \Diamantes\Container::getInstance()->stateRepository()->read(
        'gp_normalize_state',
        'gp_default_state'
    );
}

function gp_update_state(callable $mutator): mixed
{
    return \Diamantes\Container::getInstance()->stateRepository()->update(
        $mutator,
        'gp_normalize_state',
        'gp_default_state'
    );
}

// ── Auth — password ───────────────────────────────────────────────────────────

function gp_verify_password(string $input, string $stored): bool
{
    return \Diamantes\Auth\PasswordHasher::verify($input, $stored);
}

// ── Auth — session ────────────────────────────────────────────────────────────

function gp_set_session_user(array $user): void
{
    \Diamantes\Auth\SessionManager::setUser($user);
}

function gp_clear_session(): void
{
    \Diamantes\Auth\SessionManager::clear();
}

function gp_get_session_user(): ?array
{
    $userId = \Diamantes\Auth\SessionManager::getUserId();
    if ($userId === '') {
        return null;
    }
    $state = gp_read_state();
    return \Diamantes\Users\UserService::findById($state, $userId);
}

// ── Auth — CSRF ───────────────────────────────────────────────────────────────

function gp_get_csrf_token(): string
{
    return \Diamantes\Auth\CsrfTokenManager::getToken();
}

function gp_require_csrf_header(): void
{
    \Diamantes\Auth\CsrfTokenManager::requireHeader();
}

// ── Auth — rate limiting ──────────────────────────────────────────────────────

function gp_rate_limit_read(): array
{
    // Kept for backward-compat; tests read the rate-limit file directly.
    if (!is_file(GP_RATE_LIMIT_FILE)) {
        return [];
    }
    $data = @file_get_contents(GP_RATE_LIMIT_FILE);
    if ($data === false || $data === '') {
        return [];
    }
    $decoded = json_decode($data, true);
    return is_array($decoded) ? $decoded : [];
}

function gp_rate_limit_write(array $data): void
{
    // Kept for backward-compat.
    gp_ensure_storage();
    $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        return;
    }
    @file_put_contents(GP_RATE_LIMIT_FILE, $payload, LOCK_EX);
}

function gp_rate_limit_key(string $identifier): string
{
    $ip = gp_client_ip();
    return 'ip:' . sha1($ip) . '|id:' . sha1($identifier);
}

function gp_check_rate_limit(string $identifier): void
{
    \Diamantes\Container::getInstance()->rateLimiter()->check($identifier);
}

function gp_record_rate_limit_failure(string $identifier): void
{
    \Diamantes\Container::getInstance()->rateLimiter()->recordFailure($identifier);
}

function gp_clear_rate_limit(string $identifier): void
{
    \Diamantes\Container::getInstance()->rateLimiter()->clear($identifier);
}

// ── Auth — audit log ──────────────────────────────────────────────────────────

function gp_append_audit_log(string $event, array $context = []): void
{
    \Diamantes\Container::getInstance()->auditLogger()->log($event, $context);
}

// ── Auth — guards ─────────────────────────────────────────────────────────────

function gp_require_auth(): array
{
    $user = gp_get_session_user();
    if (!$user) {
        gp_json_response(['ok' => false, 'error' => 'Sessão inválida.'], 401);
    }
    return $user;
}

function gp_require_admin(): array
{
    $user = gp_require_auth();
    if (($user['role'] ?? '') !== 'admin') {
        gp_json_response(['ok' => false, 'error' => 'Acesso restrito ao admin.'], 403);
    }
    return $user;
}

function gp_require_client_access(string $clientSlug): array
{
    $user = gp_require_auth();
    if (($user['role'] ?? '') === 'admin') {
        return $user;
    }

    $isApprovedClient = ($user['role'] ?? '') === 'client'
        && ($user['status'] ?? '') === 'approved'
        && ($user['clientSlug'] ?? '') === trim($clientSlug);

    if (!$isApprovedClient) {
        gp_json_response(['ok' => false, 'error' => 'Acesso negado para esse portal.'], 403);
    }

    return $user;
}

// ── Users ─────────────────────────────────────────────────────────────────────

function gp_normalize_email(string $value): string
{
    return \Diamantes\Users\UserService::normalizeEmail($value);
}

function gp_normalize_identifier(string $value): string
{
    return \Diamantes\Users\UserService::normalizeIdentifier($value);
}

function gp_normalize_document_type(?string $value): string
{
    return \Diamantes\Users\UserService::normalizeDocumentType($value);
}

function gp_get_document_length(string $type): int
{
    return \Diamantes\Users\UserService::getDocumentLength($type);
}

function gp_digits_only(string $value, int $maxLength): string
{
    return \Diamantes\Users\UserService::digitsOnly($value, $maxLength);
}

function gp_normalize_document_value(string $type, string $value): string
{
    return \Diamantes\Users\UserService::normalizeDocumentValue($type, $value);
}

function gp_infer_document_type(string $value, string $fallback = 'cpf'): string
{
    return \Diamantes\Users\UserService::inferDocumentType($value, $fallback);
}

function gp_get_user_document(array $user): array
{
    return \Diamantes\Users\UserService::getUserDocument($user);
}

function gp_is_seed_admin_record(array $user): bool
{
    return \Diamantes\Users\UserService::isSeedAdminRecord($user);
}

function gp_normalize_user(array $user): array
{
    return \Diamantes\Users\UserService::normalize($user);
}

function gp_public_user(array $user): array
{
    return \Diamantes\Users\UserService::publicUser($user);
}

function gp_update_user_record(array $state, string $userId, array $patch): array
{
    return \Diamantes\Users\UserService::updateRecord($state, $userId, $patch);
}

function gp_validate_registration_input(array $data): array
{
    return \Diamantes\Users\UserService::validateRegistrationInput($data);
}

function gp_find_user_by_id(array $state, string $userId): ?array
{
    return \Diamantes\Users\UserService::findById($state, $userId);
}

function gp_find_user_by_identifier(array $state, string $identifier): ?array
{
    return \Diamantes\Users\UserService::findByIdentifier($state, $identifier);
}

function gp_find_client_user_emails(array $state, string $clientSlug): array
{
    return \Diamantes\Users\UserService::findClientUserEmails($state, $clientSlug);
}

// ── Integrations — ClickUp ────────────────────────────────────────────────────

function gp_get_clickup_api_key(): string
{
    $config = gp_read_json_file(GP_DATA_DIR . '/clickup-config.json', []);
    $candidates = [
        getenv('GP_CLICKUP_API_KEY') ?: '',
        getenv('CLICKUP_API_KEY') ?: '',
        gp_read_secret_text_file(GP_DATA_DIR . '/clickup-api-key.txt'),
        trim((string)($config['apiKey'] ?? '')),
        trim((string)($config['clickupApiKey'] ?? '')),
        trim((string)($config['token'] ?? '')),
    ];
    foreach ($candidates as $candidate) {
        $value = trim((string)$candidate);
        if ($value !== '') {
            return $value;
        }
    }
    return '';
}

function gp_get_clickup_webhook_secret(): string
{
    return trim((string)(getenv('GP_CLICKUP_WEBHOOK_SECRET') ?: getenv('CLICKUP_WEBHOOK_SECRET') ?: ''));
}

function gp_get_clickup_client_relation_field_id(): string
{
    return trim((string)(getenv('GP_CLICKUP_CLIENT_RELATION_FIELD_ID') ?: GP_CLICKUP_CLIENT_RELATION_FIELD_ID));
}

function gp_http_request(string $method, string $url, mixed $body = null, array $headers = [], array $files = []): array
{
    return \Diamantes\Integrations\ClickUpClient::httpRequest($method, $url, $body, $headers, $files);
}

function gp_clickup_request(string $method, string $path, mixed $body = null, array $extraHeaders = [], array $files = []): array
{
    return \Diamantes\Container::getInstance()->clickUpClient()->request($method, $path, $body, $extraHeaders, $files);
}

function gp_clickup_get_task(string $taskId): array
{
    return \Diamantes\Container::getInstance()->clickUpClient()->getTask($taskId);
}

// ── Integrations — Sheets ─────────────────────────────────────────────────────

function gp_get_sheets_sync_url(): string
{
    return \Diamantes\Integrations\SheetsSync::urlFromEnv();
}

function gp_get_sheets_sync_secret(): string
{
    return \Diamantes\Integrations\SheetsSync::secretFromEnv();
}

// ── Integrations — Mailer ─────────────────────────────────────────────────────

function gp_get_app_base_url(): string
{
    return rtrim((string)(getenv('GP_APP_BASE_URL') ?: 'https://diamantes.grupoparticipa.app.br'), '/');
}

function gp_get_mail_from_email(): string
{
    return \Diamantes\Integrations\Mailer::fromEmailFromEnv();
}

function gp_get_mail_from_name(): string
{
    return \Diamantes\Integrations\Mailer::fromNameFromEnv();
}

function gp_notification_subject(string $subject): string
{
    if (function_exists('mb_encode_mimeheader')) {
        return mb_encode_mimeheader($subject, 'UTF-8');
    }
    return $subject;
}

function gp_send_email(array $recipients, string $subject, string $body, array $meta = []): bool
{
    return \Diamantes\Container::getInstance()->mailer()->send($recipients, $subject, $body, $meta);
}

// ── Domain helpers — client routes / profiles / contracts ────────────────────

function gp_client_routes(): array
{
    return [
        ['slug' => 'alessandro-lima', 'label' => 'Alessandro Lima', 'path' => 'alessandro-lima/index.html'],
        ['slug' => 'anthony-sodre', 'label' => 'Anthony Sodré', 'path' => 'anthony-sodre/index.html'],
        ['slug' => 'bartira-paes', 'label' => 'Bartira Paes', 'path' => 'bartira-paes/index.html'],
        ['slug' => 'bernadete', 'label' => 'Bernadete', 'path' => 'bernadete/index.html'],
        ['slug' => 'bruno-couto', 'label' => 'Bruno Couto', 'path' => 'bruno-couto/index.html'],
        ['slug' => 'claudia-kellner', 'label' => 'Claudia Kellner', 'path' => 'claudia-kellner/index.html'],
        ['slug' => 'deyse-engel', 'label' => 'Deyse Engel', 'path' => 'deyse-engel/index.html'],
        ['slug' => 'fabiana-parro', 'label' => 'Fabiana Parro', 'path' => 'fabiana-parro/index.html'],
        ['slug' => 'isabela-teixeira', 'label' => 'Isabela Teixeira', 'path' => 'isabela-teixeira/index.html'],
        ['slug' => 'felipe-schroeder', 'label' => 'Felipe Schroeder', 'path' => 'felipe-schroeder/index.html'],
        ['slug' => 'fernanda-lessa', 'label' => 'Fernanda Lessa', 'path' => 'fernanda-lessa/index.html'],
        ['slug' => 'joao-carlos-lima', 'label' => 'João Carlos Lima', 'path' => 'joao-carlos-lima/index.html'],
        ['slug' => 'joao-eduardo-zanela', 'label' => 'João Eduardo Zanela', 'path' => 'joao-eduardo-zanela/index.html'],
        ['slug' => 'katia-paixao', 'label' => 'Katia Paixão', 'path' => 'katia-paixao/index.html'],
        ['slug' => 'luciano-simionato', 'label' => 'Luciano Simionato', 'path' => 'luciano-simionato/index.html'],
        ['slug' => 'luis-rocha', 'label' => 'Luís Rocha', 'path' => 'luis-rocha/index.html'],
        ['slug' => 'matheus-borges', 'label' => 'Matheus Borges', 'path' => 'matheus-borges/index.html'],
        ['slug' => 'nairio', 'label' => 'Naírio', 'path' => 'nairio/index.html'],
        ['slug' => 'osvaldo-catena', 'label' => 'Osvaldo Catena', 'path' => 'osvaldo-catena/index.html'],
        ['slug' => 'paulo-guaraciaba', 'label' => 'Paulo Guaraciaba', 'path' => 'paulo-guaraciaba/index.html'],
        ['slug' => 'pedro-nery', 'label' => 'Pedro Nery', 'path' => 'pedro-nery/index.html'],
        ['slug' => 'priscila-ziliani', 'label' => 'Priscila Ziliani', 'path' => 'priscila-ziliani/index.html'],
        ['slug' => 'rafael-molino', 'label' => 'Rafael Molino', 'path' => 'rafael-molino/index.html'],
        ['slug' => 'roberto-gaspar', 'label' => 'Roberto Gaspar', 'path' => 'roberto-gaspar/index.html'],
        ['slug' => 'suely-resende', 'label' => 'Suely Resende', 'path' => 'suely-resende/index.html'],
        ['slug' => 'vitor-negrao', 'label' => 'Vitor Negrão', 'path' => 'vitor-negrao/index.html'],
        ['slug' => 'willian-loro', 'label' => 'Willian Loro', 'path' => 'willian-loro/index.html'],
    ];
}

function gp_find_client_route(string $clientSlug): ?array
{
    foreach (gp_client_routes() as $route) {
        if (($route['slug'] ?? '') === trim($clientSlug)) {
            return $route;
        }
    }
    return null;
}

function gp_get_client_portal_url(string $clientSlug): string
{
    $route = gp_find_client_route($clientSlug);
    if ($route && !empty($route['path'])) {
        return gp_get_app_base_url() . '/' . ltrim((string)$route['path'], '/');
    }
    return gp_get_app_base_url();
}

function gp_default_admin(): array
{
    // Sentinel password: empty string signals "account not bootstrapped".
    // gp_verify_password() will reject empty stored hashes, so login is
    // impossible until setup-admin.php is run with real credentials.
    return [
        'id' => 'seed-admin',
        'name' => 'Administrador',
        'email' => 'admin',
        'password' => '',
        'documentType' => 'cpf',
        'documentValue' => '00000000000',
        'cpf' => '00000000000',
        'role' => 'admin',
        'status' => 'approved',
        'clientSlug' => '',
        'createdAt' => '2026-03-23T00:00:00.000Z',
        'updatedAt' => '2026-03-23T00:00:00.000Z',
    ];
}

function gp_today_br(): string
{
    $now = new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo'));
    return $now->format('Y-m-d');
}

function gp_blank_seminar_data(): array
{
    return [
        'instagram' => '',
        'facebook' => '',
        'youtube' => '',
        'siteUrl' => '',
        'capturePageUrl' => '',
        'thankYouPageUrl' => '',
        'driveUrl' => '',
        'seminarDay1Date' => '',
        'pitchDate' => '',
        'cartCloseDate' => '',
        'testsStartDate' => '',
        'scaleStartDate' => '',
        'acquisitionChannels' => [],
        'acquisitionInvestment' => '',
        'acquisitionGoogleShare' => '',
        'acquisitionMetaShare' => '',
        'contentDistributionEnabled' => false,
        'contentDistributionAmount' => '',
        'contentDistributionGoogleShare' => '',
        'contentDistributionMetaShare' => '',
        'targetRegion' => '',
        'lastSeminarDate' => '',
        'lastSeminarLeads' => '',
        'targetLeads' => '',
        'emailMarketingTool' => '',
        'pageBuilder' => '',
        'whatsappApiEnabled' => false,
        'whatsappApiTool' => '',
    ];
}

function gp_normalize_profile_date(mixed $value): string
{
    $date = trim((string)$value);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : '';
}

function gp_normalize_profile_number(mixed $value): string
{
    if ($value === null) {
        return '';
    }
    return trim((string)$value);
}

function gp_normalize_client_profile(string $slug, array $profile, string $fallbackName = ''): array
{
    $seminar = array_merge(
        gp_blank_seminar_data(),
        is_array($profile['seminar'] ?? null) ? $profile['seminar'] : []
    );
    $billingStatus = (string)($profile['billingStatus'] ?? 'current');
    if (!in_array($billingStatus, ['current', 'late', 'canceled'], true)) {
        $billingStatus = 'current';
    }

    $channels = array_values(array_unique(array_filter(array_map(
        static function ($channel): string {
            $value = trim(mb_strtolower((string)$channel, 'UTF-8'));
            return in_array($value, ['google', 'meta'], true) ? $value : '';
        },
        is_array($seminar['acquisitionChannels'] ?? null) ? $seminar['acquisitionChannels'] : []
    ))));

    return [
        'slug' => trim($slug),
        'name' => trim((string)($profile['name'] ?? $fallbackName)),
        'billingStatus' => $billingStatus,
        'contractStartedAt' => gp_normalize_profile_date($profile['contractStartedAt'] ?? ''),
        'contractEndedAt' => gp_normalize_profile_date($profile['contractEndedAt'] ?? ''),
        'seminar' => [
            'instagram' => trim((string)($seminar['instagram'] ?? '')),
            'facebook' => trim((string)($seminar['facebook'] ?? '')),
            'youtube' => trim((string)($seminar['youtube'] ?? '')),
            'siteUrl' => trim((string)($seminar['siteUrl'] ?? '')),
            'capturePageUrl' => trim((string)($seminar['capturePageUrl'] ?? '')),
            'thankYouPageUrl' => trim((string)($seminar['thankYouPageUrl'] ?? '')),
            'driveUrl' => trim((string)($seminar['driveUrl'] ?? '')),
            'seminarDay1Date' => gp_normalize_profile_date($seminar['seminarDay1Date'] ?? ''),
            'pitchDate' => gp_normalize_profile_date($seminar['pitchDate'] ?? ''),
            'cartCloseDate' => gp_normalize_profile_date($seminar['cartCloseDate'] ?? ''),
            'testsStartDate' => gp_normalize_profile_date($seminar['testsStartDate'] ?? ''),
            'scaleStartDate' => gp_normalize_profile_date($seminar['scaleStartDate'] ?? ''),
            'acquisitionChannels' => $channels,
            'acquisitionInvestment' => gp_normalize_profile_number($seminar['acquisitionInvestment'] ?? ''),
            'acquisitionGoogleShare' => gp_normalize_profile_number($seminar['acquisitionGoogleShare'] ?? ''),
            'acquisitionMetaShare' => gp_normalize_profile_number($seminar['acquisitionMetaShare'] ?? ''),
            'contentDistributionEnabled' => !empty($seminar['contentDistributionEnabled']),
            'contentDistributionAmount' => gp_normalize_profile_number($seminar['contentDistributionAmount'] ?? ''),
            'contentDistributionGoogleShare' => gp_normalize_profile_number($seminar['contentDistributionGoogleShare'] ?? ''),
            'contentDistributionMetaShare' => gp_normalize_profile_number($seminar['contentDistributionMetaShare'] ?? ''),
            'targetRegion' => trim((string)($seminar['targetRegion'] ?? '')),
            'lastSeminarDate' => gp_normalize_profile_date($seminar['lastSeminarDate'] ?? ''),
            'lastSeminarLeads' => gp_normalize_profile_number($seminar['lastSeminarLeads'] ?? ''),
            'targetLeads' => gp_normalize_profile_number($seminar['targetLeads'] ?? ''),
            'emailMarketingTool' => trim((string)($seminar['emailMarketingTool'] ?? '')),
            'pageBuilder' => trim((string)($seminar['pageBuilder'] ?? '')),
            'whatsappApiEnabled' => !empty($seminar['whatsappApiEnabled']),
            'whatsappApiTool' => trim((string)($seminar['whatsappApiTool'] ?? '')),
        ],
        'updatedAt' => (string)($profile['updatedAt'] ?? gp_now_iso()),
    ];
}

function gp_extract_client_name_by_slug(array $contracts, string $slug): string
{
    foreach ($contracts as $client) {
        if (($client['slug'] ?? '') === $slug) {
            return trim((string)($client['name'] ?? ''));
        }
    }
    return '';
}

function gp_default_client_profiles(array $contracts): array
{
    $profiles = [];
    foreach ($contracts as $client) {
        $slug = trim((string)($client['slug'] ?? ''));
        if ($slug === '') {
            continue;
        }
        $profiles[$slug] = gp_normalize_client_profile(
            $slug,
            [],
            trim((string)($client['name'] ?? $slug))
        );
    }
    return $profiles;
}

function gp_default_state(): array
{
    $contracts = gp_read_json_file(GP_DATA_DIR . '/portal-contracts.json', ['clients' => []]);
    $contractClients = is_array($contracts['clients'] ?? null) ? $contracts['clients'] : [];
    return [
        'users' => [gp_default_admin()],
        'contractRegistry' => $contractClients,
        'contractStatus' => [],
        'ratings' => [],
        'clientProfiles' => gp_default_client_profiles($contractClients),
        'taskReviews' => [],
    ];
}

function gp_normalize_state(array $state): array
{
    $defaults = gp_default_state();
    $normalized = [
        'users' => [],
        'contractRegistry' => is_array($state['contractRegistry'] ?? null) ? $state['contractRegistry'] : $defaults['contractRegistry'],
        'contractStatus' => is_array($state['contractStatus'] ?? null) ? $state['contractStatus'] : [],
        'ratings' => is_array($state['ratings'] ?? null) ? $state['ratings'] : [],
        'clientProfiles' => [],
        'taskReviews' => [],
    ];

    $users = is_array($state['users'] ?? null) ? $state['users'] : [];
    foreach ($users as $user) {
        if (!is_array($user)) {
            continue;
        }
        $normalized['users'][] = gp_normalize_user($user);
    }

    $admin = gp_default_admin();
    $hasSeedAdmin = false;
    foreach ($normalized['users'] as &$user) {
        if (gp_is_seed_admin_record($user)) {
            // User record wins over defaults — specifically preserves the stored password.
            $user = gp_normalize_user(array_merge($admin, $user));
            $hasSeedAdmin = true;
            break;
        }
    }
    unset($user);

    if (!$hasSeedAdmin) {
        // No existing seed-admin: insert sentinel (login blocked until setup-admin.php runs).
        $normalized['users'][] = $admin;
    }

    $rawProfiles = is_array($state['clientProfiles'] ?? null) ? $state['clientProfiles'] : [];
    foreach ($normalized['contractRegistry'] as $client) {
        $slug = trim((string)($client['slug'] ?? ''));
        if ($slug === '') {
            continue;
        }
        $normalized['clientProfiles'][$slug] = gp_normalize_client_profile(
            $slug,
            is_array($rawProfiles[$slug] ?? null) ? $rawProfiles[$slug] : [],
            trim((string)($client['name'] ?? $slug))
        );
    }

    foreach ($rawProfiles as $slug => $profile) {
        $slug = trim((string)$slug);
        if ($slug === '' || isset($normalized['clientProfiles'][$slug])) {
            continue;
        }
        $normalized['clientProfiles'][$slug] = gp_normalize_client_profile(
            $slug,
            is_array($profile) ? $profile : [],
            gp_extract_client_name_by_slug($normalized['contractRegistry'], $slug)
        );
    }

    $rawTaskReviews = is_array($state['taskReviews'] ?? null) ? $state['taskReviews'] : [];
    foreach ($rawTaskReviews as $review) {
        if (!is_array($review)) {
            continue;
        }
        $normalizedReview = gp_normalize_task_review($review);
        if (($normalizedReview['taskId'] ?? '') === '') {
            continue;
        }
        $normalized['taskReviews'][] = $normalizedReview;
    }

    return $normalized;
}

// ── Domain helpers — ClickUp / task review ────────────────────────────────────

function gp_normalize_entity_name(string $value): string
{
    return mb_strtoupper(trim($value), 'UTF-8');
}

function gp_service_label_alias(string $value): string
{
    $normalized = gp_normalize_entity_name($value);
    if ($normalized === 'DESENVOLVEDOR WEB') {
        return 'WEBDESIGNER';
    }
    if ($normalized === 'EDIÇÃO') {
        return 'EDIÇÃO DE VÍDEO';
    }
    if ($normalized === 'COPY') {
        return 'COPYWRITER';
    }
    return $normalized;
}

function gp_contract_key(string $clientSlug, string $service, string $employee): string
{
    return trim($clientSlug) . '::' . gp_service_label_alias($service) . '::' . gp_normalize_entity_name($employee);
}

function gp_normalize_task_review(array $review): array
{
    $status = (string)($review['status'] ?? '');
    if (!in_array($status, ['approved', 'changes_requested'], true)) {
        $status = 'approved';
    }

    return [
        'taskId' => trim((string)($review['taskId'] ?? '')),
        'taskName' => trim((string)($review['taskName'] ?? '')),
        'clientSlug' => trim((string)($review['clientSlug'] ?? '')),
        'clientName' => trim((string)($review['clientName'] ?? '')),
        'service' => gp_service_label_alias((string)($review['service'] ?? '')),
        'employee' => gp_normalize_entity_name((string)($review['employee'] ?? '')),
        'status' => $status,
        'notes' => trim((string)($review['notes'] ?? '')),
        'resolvedAt' => $review['resolvedAt'] ?? null,
        'revisionKey' => trim((string)($review['revisionKey'] ?? '')),
        'url' => trim((string)($review['url'] ?? '')),
        'submittedAt' => trim((string)($review['submittedAt'] ?? gp_now_iso())),
    ];
}

function gp_get_client_active_services(array $state, string $clientSlug): array
{
    $slug = trim($clientSlug);
    if ($slug === '') {
        return [];
    }

    $contractStatus = is_array($state['contractStatus'] ?? null) ? $state['contractStatus'] : [];
    foreach (($state['contractRegistry'] ?? []) as $client) {
        if (($client['slug'] ?? '') !== $slug) {
            continue;
        }

        $services = is_array($client['services'] ?? null) ? $client['services'] : [];
        return array_values(array_filter(array_map(
            static function (array $service) use ($slug, $contractStatus): ?array {
                $serviceName = gp_service_label_alias((string)($service['service'] ?? ''));
                $employee = gp_normalize_entity_name((string)($service['employee'] ?? ''));
                if ($serviceName === '' || $employee === '') {
                    return null;
                }

                $key = gp_contract_key($slug, $serviceName, $employee);
                if (($contractStatus[$key] ?? 'active') === 'canceled') {
                    return null;
                }

                return [
                    'service' => $serviceName,
                    'employee' => $employee,
                    'startedAt' => gp_normalize_profile_date((string)($service['startedAt'] ?? '')),
                    'endedAt' => gp_normalize_profile_date((string)($service['endedAt'] ?? '')),
                ];
            },
            $services
        ), static fn($item): bool => is_array($item)));
    }

    return [];
}

function gp_clickup_employee_assignee_ids(): array
{
    static $ids = null;
    if ($ids !== null) {
        return $ids;
    }

    $ids = [
        'ALEXANDRE MAGNO' => 81934453,
        'MATEUS CASTRO' => 81934455,
        'JADSON' => 81934456,
        'VINÍCIUS PEREIRA' => 81934459,
        'VINICIUS PEREIRA' => 81934459,
        'LUIS FERNANDO' => 81934454,
        'MANUELA RIOS' => 84099161,
        'CAIO MARCONDES' => 84118999,
        'MARCOS PAULO' => 118013882,
        'GABRIEL MENEZES' => 84782862,
        'ELAINE MONTENEGRO' => 90616609,
        'RENAN SCHWARZ' => 106071076,
        'JUNIOR' => 111931366,
        'GABRIEL ALVES' => 230453991,
    ];

    return $ids;
}

function gp_get_clickup_employee_id(string $employee): int
{
    return (int)(gp_clickup_employee_assignee_ids()[gp_normalize_entity_name($employee)] ?? 0);
}

function gp_resolve_clickup_client(array $task): array
{
    $relationFieldId = gp_get_clickup_client_relation_field_id();
    $clientName = '';
    $clientTaskId = '';

    foreach (($task['custom_fields'] ?? []) as $field) {
        if (!is_array($field)) {
            continue;
        }
        $fieldId = (string)($field['id'] ?? '');
        $fieldName = (string)($field['name'] ?? '');
        $fieldType = (string)($field['type'] ?? '');

        if ($fieldId === $relationFieldId && $fieldType === 'list_relationship') {
            $value = is_array($field['value'] ?? null) ? $field['value'] : [];
            if (!empty($value) && is_array($value[0])) {
                $clientName = trim((string)($value[0]['name'] ?? ''));
                $clientTaskId = trim((string)($value[0]['id'] ?? ''));
                break;
            }
        }

        if ($clientName === '' && $fieldName === 'Cliente' && $fieldType === 'short_text') {
            $clientName = trim((string)($field['value'] ?? ''));
        }
    }

    return ['name' => $clientName, 'taskId' => $clientTaskId];
}

// ── Domain helpers — backend directory / notifications ────────────────────────

function gp_backend_clients_directory(): array
{
    static $directory = null;
    if ($directory !== null) {
        return $directory;
    }

    $entries = gp_read_json_file(GP_ROOT . '/backend/clients.json', []);
    $bySlug = [];
    $byTaskId = [];

    foreach ($entries as $entry) {
        if (!is_array($entry)) {
            continue;
        }

        $slug = trim((string)($entry['slug'] ?? ''));
        $taskId = trim((string)($entry['client_task_id'] ?? ''));
        if ($slug === '') {
            continue;
        }

        $normalized = [
            'slug' => $slug,
            'client_task_id' => $taskId,
            'emails' => array_values(array_unique(array_filter(array_map(
                static fn(string $email): string => gp_normalize_email($email),
                is_array($entry['emails'] ?? null) ? $entry['emails'] : []
            )))),
        ];

        $bySlug[$slug] = $normalized;
        if ($taskId !== '') {
            $byTaskId[$taskId] = $slug;
        }
    }

    $directory = [
        'bySlug' => $bySlug,
        'byTaskId' => $byTaskId,
    ];

    return $directory;
}

function gp_find_client_slug_by_task_id(string $taskId): string
{
    $directory = gp_backend_clients_directory();
    return $directory['byTaskId'][trim($taskId)] ?? '';
}

function gp_get_client_task_id(string $clientSlug): string
{
    $directory = gp_backend_clients_directory();
    $entry = $directory['bySlug'][trim($clientSlug)] ?? null;
    return is_array($entry) ? trim((string)($entry['client_task_id'] ?? '')) : '';
}

function gp_has_client_profile_response(array $profile): bool
{
    $seminar = is_array($profile['seminar'] ?? null) ? $profile['seminar'] : [];
    foreach ($seminar as $value) {
        if (is_array($value) && !empty($value)) {
            return true;
        }
        if (is_bool($value) && $value === true) {
            return true;
        }
        if (trim((string)$value) !== '') {
            return true;
        }
    }
    return false;
}

function gp_format_profile_date(string $value): string
{
    $normalized = gp_normalize_profile_date($value);
    if ($normalized === '') {
        return '—';
    }
    try {
        return (new DateTimeImmutable($normalized))->format('d/m/Y');
    } catch (Throwable $error) {
        return $normalized;
    }
}

function gp_format_profile_datetime(string $value): string
{
    $input = trim($value);
    if ($input === '') {
        return '—';
    }
    try {
        $date = new DateTimeImmutable($input);
        return $date
            ->setTimezone(new DateTimeZone('America/Sao_Paulo'))
            ->format('d/m/Y, H:i');
    } catch (Throwable $error) {
        return $input;
    }
}

function gp_notification_marker_path(string $group, string $key): string
{
    $groupName = preg_replace('/[^a-z0-9._-]+/i', '-', strtolower(trim($group))) ?: 'default';
    return GP_NOTIFICATION_MARKER_DIR . '/' . $groupName . '/' . sha1($key) . '.lock';
}

function gp_has_notification_marker(string $group, string $key): bool
{
    return is_file(gp_notification_marker_path($group, $key));
}

function gp_claim_notification_marker(string $group, string $key): bool
{
    gp_ensure_storage();
    $file = gp_notification_marker_path($group, $key);
    $markerDir = dirname($file);
    if (!is_dir($markerDir) && !mkdir($markerDir, 0775, true) && !is_dir($markerDir)) {
        return false;
    }

    $handle = @fopen($file, 'x');
    if ($handle === false) {
        return false;
    }
    fwrite($handle, $key . PHP_EOL);
    fclose($handle);
    return true;
}

function gp_build_profile_clickup_comment(string $clientName, array $profile, array $activeServices): string
{
    $seminar = array_merge(
        gp_blank_seminar_data(),
        is_array($profile['seminar'] ?? null) ? $profile['seminar'] : []
    );
    $channels = array_values(array_filter(array_map(static function ($channel): string {
        $value = trim((string)$channel);
        if ($value === 'google') {
            return 'Google';
        }
        if ($value === 'meta') {
            return 'Meta';
        }
        return $value;
    }, is_array($seminar['acquisitionChannels'] ?? null) ? $seminar['acquisitionChannels'] : [])));

    $team = array_map(static function (array $service): string {
        return gp_service_label_alias((string)($service['service'] ?? '')) . ': ' . gp_normalize_entity_name((string)($service['employee'] ?? ''));
    }, $activeServices);

    $lines = [
        '[PERFIL MENSAL ' . gp_normalize_entity_name($clientName) . ']',
        'Atualizado via portal em ' . gp_format_profile_datetime((string)($profile['updatedAt'] ?? gp_now_iso())),
        'Prestadores ativos: ' . ($team ? implode(' | ', $team) : '—'),
        '',
        'Instagram: ' . ((string)($seminar['instagram'] ?? '') ?: '—'),
        'Facebook: ' . ((string)($seminar['facebook'] ?? '') ?: '—'),
        'YouTube: ' . ((string)($seminar['youtube'] ?? '') ?: '—'),
        'Site: ' . ((string)($seminar['siteUrl'] ?? '') ?: '—'),
        'Página de captura: ' . ((string)($seminar['capturePageUrl'] ?? '') ?: '—'),
        'Página de obrigado: ' . ((string)($seminar['thankYouPageUrl'] ?? '') ?: '—'),
        'Drive do cliente: ' . ((string)($seminar['driveUrl'] ?? '') ?: '—'),
        'Dia 1 do seminário: ' . gp_format_profile_date((string)($seminar['seminarDay1Date'] ?? '')),
        'Pitch: ' . gp_format_profile_date((string)($seminar['pitchDate'] ?? '')),
        'Fechamento de carrinho: ' . gp_format_profile_date((string)($seminar['cartCloseDate'] ?? '')),
        'Início dos testes de captação: ' . gp_format_profile_date((string)($seminar['testsStartDate'] ?? '')),
        'Início da escala de captação: ' . gp_format_profile_date((string)($seminar['scaleStartDate'] ?? '')),
        'Canais de captação: ' . ($channels ? implode(', ', $channels) : '—'),
        'Investimento em captação: ' . ((string)($seminar['acquisitionInvestment'] ?? '') ?: '—'),
        'Proporção Google/Meta na captação: ' . (((string)($seminar['acquisitionGoogleShare'] ?? '') ?: '—') . ' / ' . ((string)($seminar['acquisitionMetaShare'] ?? '') ?: '—')),
        'Distribuição de conteúdo: ' . (!empty($seminar['contentDistributionEnabled']) ? 'Sim' : 'Não'),
        'Valor da distribuição: ' . ((string)($seminar['contentDistributionAmount'] ?? '') ?: '—'),
        'Proporção Google/Meta na distribuição: ' . (((string)($seminar['contentDistributionGoogleShare'] ?? '') ?: '—') . ' / ' . ((string)($seminar['contentDistributionMetaShare'] ?? '') ?: '—')),
        'Região de captação: ' . ((string)($seminar['targetRegion'] ?? '') ?: '—'),
        'Último seminário: ' . gp_format_profile_date((string)($seminar['lastSeminarDate'] ?? '')),
        'Leads do último seminário: ' . ((string)($seminar['lastSeminarLeads'] ?? '') ?: '—'),
        'Meta de leads: ' . ((string)($seminar['targetLeads'] ?? '') ?: '—'),
        'Ferramenta de email marketing: ' . ((string)($seminar['emailMarketingTool'] ?? '') ?: '—'),
        'Construtor de páginas: ' . ((string)($seminar['pageBuilder'] ?? '') ?: '—'),
        'Usa API do WhatsApp: ' . (!empty($seminar['whatsappApiEnabled']) ? 'Sim' : 'Não'),
        'Ferramenta da API do WhatsApp: ' . ((string)($seminar['whatsappApiTool'] ?? '') ?: '—'),
    ];

    return implode("\n", $lines);
}

function gp_sync_profile_to_clickup(string $clientSlug, array $profile, array $state): void
{
    $slug = trim($clientSlug);
    if ($slug === '') {
        return;
    }

    $taskId = gp_get_client_task_id($slug);
    if ($taskId === '') {
        gp_append_log_line(GP_NOTIFICATION_LOG_FILE, [
            'time' => gp_now_iso(),
            'ok' => false,
            'subject' => 'sync_profile_to_clickup',
            'meta' => [
                'clientSlug' => $slug,
                'reason' => 'missing_client_task_id',
            ],
        ]);
        return;
    }

    $activeServices = gp_get_client_active_services($state, $slug);
    $assigneeIds = array_values(array_unique(array_filter(array_map(
        static function (array $service): int {
            return gp_get_clickup_employee_id((string)($service['employee'] ?? ''));
        },
        $activeServices
    ))));

    foreach ($assigneeIds as $assigneeId) {
        try {
            gp_clickup_request('POST', 'task/' . rawurlencode($taskId) . '/assignee/' . rawurlencode((string)$assigneeId));
        } catch (Throwable $error) {
            gp_append_log_line(GP_NOTIFICATION_LOG_FILE, [
                'time' => gp_now_iso(),
                'ok' => false,
                'subject' => 'sync_profile_assignee_failed',
                'meta' => [
                    'clientSlug' => $slug,
                    'taskId' => $taskId,
                    'assigneeId' => $assigneeId,
                    'error' => $error->getMessage(),
                ],
            ]);
        }
    }

    try {
        $clientName = gp_extract_client_name_by_slug($state['contractRegistry'] ?? [], $slug) ?: $slug;
        gp_clickup_request('POST', 'task/' . rawurlencode($taskId) . '/comment', [
            'comment_text' => gp_build_profile_clickup_comment($clientName, $profile, $activeServices),
        ]);
    } catch (Throwable $error) {
        gp_append_log_line(GP_NOTIFICATION_LOG_FILE, [
            'time' => gp_now_iso(),
            'ok' => false,
            'subject' => 'sync_profile_comment_failed',
            'meta' => [
                'clientSlug' => $slug,
                'taskId' => $taskId,
                'error' => $error->getMessage(),
            ],
        ]);
    }
}

function gp_extract_clickup_comment_text(array $payload): string
{
    $historyItems = is_array($payload['history_items'] ?? null) ? $payload['history_items'] : [];
    foreach ($historyItems as $item) {
        if (!is_array($item)) {
            continue;
        }
        $comment = is_array($item['comment'] ?? null) ? $item['comment'] : [];
        $pieces = is_array($comment['comment'] ?? null) ? $comment['comment'] : [];
        $text = '';
        foreach ($pieces as $piece) {
            if (is_array($piece) && array_key_exists('text', $piece)) {
                $text .= (string)$piece['text'];
                continue;
            }

            if (!is_array($piece) || ($piece['type'] ?? '') !== 'tag') {
                continue;
            }

            $user = is_array($piece['user'] ?? null) ? $piece['user'] : [];
            $username = trim((string)($user['username'] ?? $user['email'] ?? ''));
            if ($username !== '') {
                $text .= '@' . $username;
            }
        }
        $text = trim($text);
        if ($text !== '') {
            return $text;
        }
    }
    return '';
}

function gp_extract_clickup_comment_author(array $payload): string
{
    $historyItems = is_array($payload['history_items'] ?? null) ? $payload['history_items'] : [];
    if (!empty($historyItems) && is_array($historyItems[0])) {
        $user = is_array($historyItems[0]['user'] ?? null) ? $historyItems[0]['user'] : [];
        $name = trim((string)($user['username'] ?? $user['email'] ?? ''));
        if ($name !== '') {
            return $name;
        }
    }
    return 'equipe';
}

function gp_extract_clickup_webhook_key(array $payload): string
{
    $webhookId = trim((string)($payload['webhook_id'] ?? ''));
    $historyItems = is_array($payload['history_items'] ?? null) ? $payload['history_items'] : [];
    $historyId = '';
    if (!empty($historyItems) && is_array($historyItems[0])) {
        $historyId = trim((string)($historyItems[0]['id'] ?? ''));
    }

    if ($webhookId !== '' && $historyId !== '') {
        return $webhookId . ':' . $historyId;
    }

    return 'fallback:' . sha1(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
}

function gp_is_client_generated_comment(string $commentText): bool
{
    $normalized = mb_strtoupper(trim($commentText), 'UTF-8');
    return str_starts_with($normalized, 'CLIENTE - ')
        || str_starts_with($normalized, '[CLIENTE ');
}

function gp_is_system_generated_comment(string $commentText): bool
{
    return str_starts_with(mb_strtoupper(trim($commentText), 'UTF-8'), '[PERFIL MENSAL ');
}

function gp_is_read_receipt_comment(string $commentText): bool
{
    return mb_strtolower(trim($commentText), 'UTF-8') === '#visto';
}

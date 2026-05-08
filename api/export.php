<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? 'sync_spreadsheet';

try {
    if ($action !== 'sync_spreadsheet') {
        gp_json_response(['ok' => false, 'error' => 'Ação inválida.'], 404);
    }

    gp_require_method('POST');
    gp_require_admin();

    $syncUrl = gp_get_sheets_sync_url();
    if ($syncUrl === '') {
        throw new RuntimeException('A URL do Apps Script ainda não foi configurada no servidor.');
    }

    $payload = gp_request_payload();
    $summary = is_array($payload['summary'] ?? null) ? $payload['summary'] : [];
    $employees = is_array($payload['employees'] ?? null) ? $payload['employees'] : [];
    $areas = is_array($payload['areas'] ?? null) ? $payload['areas'] : [];
    $diamonds = is_array($payload['diamonds'] ?? null) ? $payload['diamonds'] : [];

    if (!$diamonds) {
        throw new RuntimeException('Não existe dado suficiente para exportar.');
    }

    $requestBody = [
        'secret' => gp_get_sheets_sync_secret(),
        'source' => 'diamantes.grupoparticipa.app.br',
        'exportedAt' => gp_now_iso(),
        'summary' => [
            'employeeCount' => (int)($summary['employeeCount'] ?? 0),
            'diamondCount' => (int)($summary['diamondCount'] ?? 0),
            'activeServiceCount' => (int)($summary['activeServiceCount'] ?? 0),
            'canceledServiceCount' => (int)($summary['canceledServiceCount'] ?? 0),
            'exportedLabel' => (string)($summary['exportedAt'] ?? ''),
        ],
        'employees' => array_map(static function ($employee): array {
            return [
                'name' => (string)($employee['name'] ?? ''),
                'activeDiamonds' => (int)($employee['activeDiamonds'] ?? 0),
                'canceledServices' => (int)($employee['canceledServices'] ?? 0),
                'averageRating' => $employee['averageRating'] ?? null,
                'totalRatings' => (int)($employee['totalRatings'] ?? 0),
            ];
        }, $employees),
        'areas' => array_map(static function ($area): array {
            return [
                'area' => (string)($area['area'] ?? ''),
                'totalEmployees' => (int)($area['totalEmployees'] ?? 0),
                'employees' => array_values(array_filter(
                    is_array($area['employees'] ?? null) ? $area['employees'] : [],
                    static fn($employee): bool => trim((string)$employee) !== ''
                )),
            ];
        }, $areas),
        'diamonds' => array_map(static function ($diamond): array {
            $services = is_array($diamond['services'] ?? null) ? $diamond['services'] : [];
            return [
                'name' => (string)($diamond['name'] ?? ''),
                'slug' => (string)($diamond['slug'] ?? ''),
                'activeServices' => (int)($diamond['activeServices'] ?? 0),
                'canceledServices' => (int)($diamond['canceledServices'] ?? 0),
                'averageRating' => $diamond['averageRating'] ?? null,
                'totalRatings' => (int)($diamond['totalRatings'] ?? 0),
                'services' => array_map(static function ($service): array {
                    return [
                        'service' => (string)($service['service'] ?? ''),
                        'employee' => (string)($service['employee'] ?? ''),
                        'status' => (string)($service['status'] ?? 'Ativo'),
                    ];
                }, $services),
            ];
        }, $diamonds),
    ];

    $response = gp_http_request('POST', $syncUrl, $requestBody, [
        'Accept: application/json',
    ]);

    $decoded = json_decode($response['body'], true);
    if (($response['status'] ?? 500) >= 400) {
        $message = is_array($decoded) && !empty($decoded['error'])
            ? (string)$decoded['error']
            : 'O Apps Script recusou a sincronização.';
        throw new RuntimeException($message);
    }

    if (is_array($decoded) && array_key_exists('ok', $decoded) && $decoded['ok'] === false) {
        throw new RuntimeException((string)($decoded['error'] ?? 'Resposta inválida do Apps Script.'));
    }

    gp_json_response([
        'ok' => true,
        'message' => (string)($decoded['message'] ?? 'Planilha atualizada com sucesso.'),
        'spreadsheetUrl' => (string)($decoded['spreadsheetUrl'] ?? ''),
    ]);
} catch (RuntimeException $error) {
    gp_json_response(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    gp_json_response(['ok' => false, 'error' => 'Erro interno ao sincronizar a planilha.'], 500);
}

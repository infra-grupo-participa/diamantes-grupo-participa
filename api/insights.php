<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? 'bootstrap';

function gp_client_active_service_count(array $client, array $contractStatus): int
{
    $slug = trim((string)($client['slug'] ?? ''));
    $services = is_array($client['services'] ?? null) ? $client['services'] : [];
    $count = 0;

    foreach ($services as $service) {
        $key = gp_contract_key(
            $slug,
            (string)($service['service'] ?? ''),
            (string)($service['employee'] ?? '')
        );
        if (($contractStatus[$key] ?? 'active') !== 'canceled') {
            $count += 1;
        }
    }

    return $count;
}

function gp_ensure_client_profile(array &$state, string $clientSlug, string $fallbackName = ''): array
{
    $profiles = is_array($state['clientProfiles'] ?? null) ? $state['clientProfiles'] : [];
    $profile = is_array($profiles[$clientSlug] ?? null) ? $profiles[$clientSlug] : [];
    $profile = gp_normalize_client_profile($clientSlug, $profile, $fallbackName);
    $state['clientProfiles'][$clientSlug] = $profile;
    return $profile;
}

try {
    if ($action === 'bootstrap') {
        $user = gp_require_auth();
        if (($user['role'] ?? '') !== 'admin' && ($user['status'] ?? '') !== 'approved') {
            gp_json_response(['ok' => false, 'error' => 'Acesso indisponível.'], 403);
        }

        $state = gp_read_state();
        gp_json_response([
            'ok' => true,
            'contractRegistry' => $state['contractRegistry'],
            'contractStatus' => $state['contractStatus'],
            'ratings' => $state['ratings'],
            'clientProfiles' => $state['clientProfiles'],
            'taskReviews' => $state['taskReviews'],
        ]);
    }

    if ($action === 'upsert_contract') {
        gp_require_method('POST');
        gp_require_admin();
        $payload = gp_request_payload();
        $clientSlug = trim((string)($payload['clientSlug'] ?? ''));
        $service = gp_service_label_alias((string)($payload['service'] ?? ''));
        $employee = gp_normalize_entity_name((string)($payload['employee'] ?? ''));
        $status = ($payload['status'] ?? 'active') === 'canceled' ? 'canceled' : 'active';
        $clientName = gp_normalize_entity_name((string)($payload['clientName'] ?? ''));
        $startedAt = gp_normalize_profile_date($payload['startedAt'] ?? '') ?: gp_today_br();

        if ($clientSlug === '' || $service === '' || $employee === '') {
            throw new RuntimeException('Cliente, serviço e prestador são obrigatórios.');
        }

        $result = gp_update_state(function (array $state) use ($clientSlug, $service, $employee, $status, $clientName, $startedAt) {
            $clientIndex = null;
            foreach ($state['contractRegistry'] as $index => $client) {
                if (($client['slug'] ?? '') === $clientSlug) {
                    $clientIndex = $index;
                    break;
                }
            }

            if ($clientIndex === null) {
                $state['contractRegistry'][] = [
                    'slug' => $clientSlug,
                    'name' => $clientName ?: gp_normalize_entity_name($clientSlug),
                    'services' => [],
                ];
                $clientIndex = array_key_last($state['contractRegistry']);
            }

            $client = $state['contractRegistry'][$clientIndex];
            if (($client['name'] ?? '') === '') {
                $client['name'] = $clientName ?: gp_normalize_entity_name($clientSlug);
            }

            $alreadyExists = false;
            foreach ($client['services'] as &$registeredService) {
                $registeredName = gp_service_label_alias((string)($registeredService['service'] ?? ''));
                $registeredEmployee = gp_normalize_entity_name((string)($registeredService['employee'] ?? ''));
                if ($registeredName === $service && $registeredEmployee === $employee) {
                    $registeredService['startedAt'] = gp_normalize_profile_date($registeredService['startedAt'] ?? '') ?: $startedAt;
                    if ($status === 'canceled') {
                        $registeredService['endedAt'] = gp_today_br();
                    } elseif (!empty($registeredService['endedAt'])) {
                        $registeredService['endedAt'] = '';
                    }
                    $alreadyExists = true;
                    break;
                }
            }
            unset($registeredService);

            if (!$alreadyExists) {
                $client['services'][] = [
                    'service' => $service,
                    'employee' => $employee,
                    'startedAt' => $startedAt,
                    'endedAt' => $status === 'canceled' ? gp_today_br() : '',
                ];
            }

            usort($client['services'], static function (array $left, array $right): int {
                return strcmp((string)$left['service'], (string)$right['service'])
                    ?: strcmp((string)$left['employee'], (string)$right['employee']);
            });

            $state['contractRegistry'][$clientIndex] = $client;

            $contractKey = gp_contract_key($clientSlug, $service, $employee);
            if ($status === 'canceled') {
                $state['contractStatus'][$contractKey] = 'canceled';
            } else {
                unset($state['contractStatus'][$contractKey]);
            }

            $profile = gp_ensure_client_profile($state, $clientSlug, (string)$client['name']);
            if (($profile['contractStartedAt'] ?? '') === '') {
                $profile['contractStartedAt'] = $startedAt;
            }
            if (gp_client_active_service_count($client, $state['contractStatus']) === 0) {
                if (($profile['contractEndedAt'] ?? '') === '') {
                    $profile['contractEndedAt'] = gp_today_br();
                }
            } else {
                $profile['contractEndedAt'] = '';
            }
            $profile['updatedAt'] = gp_now_iso();
            $state['clientProfiles'][$clientSlug] = gp_normalize_client_profile($clientSlug, $profile, (string)$client['name']);

            return [$state, [
                'clientSlug' => $clientSlug,
                'service' => $service,
                'employee' => $employee,
                'status' => $status,
                'startedAt' => $startedAt,
            ]];
        });

        gp_json_response(['ok' => true, 'contract' => $result]);
    }

    if ($action === 'remove_contract') {
        gp_require_method('POST');
        gp_require_admin();
        $payload = gp_request_payload();
        $clientSlug = trim((string)($payload['clientSlug'] ?? ''));
        $service = gp_service_label_alias((string)($payload['service'] ?? ''));
        $employee = gp_normalize_entity_name((string)($payload['employee'] ?? ''));

        $removed = gp_update_state(function (array $state) use ($clientSlug, $service, $employee) {
            foreach ($state['contractRegistry'] as &$client) {
                if (($client['slug'] ?? '') !== $clientSlug) {
                    continue;
                }

                $before = count($client['services'] ?? []);
                $client['services'] = array_values(array_filter($client['services'] ?? [], static function (array $serviceItem) use ($service, $employee): bool {
                    return gp_service_label_alias((string)($serviceItem['service'] ?? '')) !== $service
                        || gp_normalize_entity_name((string)($serviceItem['employee'] ?? '')) !== $employee;
                }));

                if ($before !== count($client['services'])) {
                    unset($state['contractStatus'][gp_contract_key($clientSlug, $service, $employee)]);
                    $profile = gp_ensure_client_profile($state, $clientSlug, (string)($client['name'] ?? $clientSlug));
                    if (gp_client_active_service_count($client, $state['contractStatus']) === 0) {
                        if (($profile['contractEndedAt'] ?? '') === '') {
                            $profile['contractEndedAt'] = gp_today_br();
                        }
                    } else {
                        $profile['contractEndedAt'] = '';
                    }
                    $profile['updatedAt'] = gp_now_iso();
                    $state['clientProfiles'][$clientSlug] = gp_normalize_client_profile($clientSlug, $profile, (string)($client['name'] ?? $clientSlug));
                    return [$state, true];
                }
                break;
            }
            unset($client);

            return [$state, false];
        });

        gp_json_response(['ok' => true, 'removed' => $removed]);
    }

    if ($action === 'set_contract_status') {
        gp_require_method('POST');
        gp_require_admin();
        $payload = gp_request_payload();
        $clientSlug = trim((string)($payload['clientSlug'] ?? ''));
        $service = gp_service_label_alias((string)($payload['service'] ?? ''));
        $employee = gp_normalize_entity_name((string)($payload['employee'] ?? ''));
        $status = ($payload['status'] ?? 'active') === 'canceled' ? 'canceled' : 'active';

        $nextStatus = gp_update_state(function (array $state) use ($clientSlug, $service, $employee, $status) {
            $key = gp_contract_key($clientSlug, $service, $employee);
            if ($status === 'canceled') {
                $state['contractStatus'][$key] = 'canceled';
            } else {
                unset($state['contractStatus'][$key]);
            }

            foreach ($state['contractRegistry'] as &$client) {
                if (($client['slug'] ?? '') !== $clientSlug) {
                    continue;
                }
                foreach ($client['services'] as &$serviceItem) {
                    $sameService = gp_service_label_alias((string)($serviceItem['service'] ?? '')) === $service;
                    $sameEmployee = gp_normalize_entity_name((string)($serviceItem['employee'] ?? '')) === $employee;
                    if (!$sameService || !$sameEmployee) {
                        continue;
                    }
                    $serviceItem['startedAt'] = gp_normalize_profile_date($serviceItem['startedAt'] ?? '') ?: gp_today_br();
                    $serviceItem['endedAt'] = $status === 'canceled' ? gp_today_br() : '';
                    break 2;
                }
            }
            unset($serviceItem, $client);

            foreach ($state['contractRegistry'] as $client) {
                if (($client['slug'] ?? '') !== $clientSlug) {
                    continue;
                }
                $profile = gp_ensure_client_profile($state, $clientSlug, (string)($client['name'] ?? $clientSlug));
                if (($profile['contractStartedAt'] ?? '') === '') {
                    $profile['contractStartedAt'] = gp_today_br();
                }
                if (gp_client_active_service_count($client, $state['contractStatus']) === 0) {
                    if (($profile['contractEndedAt'] ?? '') === '') {
                        $profile['contractEndedAt'] = gp_today_br();
                    }
                } else {
                    $profile['contractEndedAt'] = '';
                }
                $profile['updatedAt'] = gp_now_iso();
                $state['clientProfiles'][$clientSlug] = gp_normalize_client_profile($clientSlug, $profile, (string)($client['name'] ?? $clientSlug));
                break;
            }

            return [$state, $status];
        });

        gp_json_response(['ok' => true, 'status' => $nextStatus]);
    }

    if ($action === 'save_client_profile') {
        gp_require_method('POST');
        $payload = gp_request_payload();
        $clientSlug = trim((string)($payload['clientSlug'] ?? ''));
        if ($clientSlug === '') {
            throw new RuntimeException('Cliente obrigatório.');
        }

        $user = gp_require_auth();
        $isAdmin = ($user['role'] ?? '') === 'admin';
        if (!$isAdmin) {
            gp_require_client_access($clientSlug);
        }

        $beforeState = gp_read_state();
        $fallbackName = gp_extract_client_name_by_slug($beforeState['contractRegistry'], $clientSlug);
        $beforeProfile = gp_normalize_client_profile(
            $clientSlug,
            is_array(($beforeState['clientProfiles'] ?? [])[$clientSlug] ?? null) ? $beforeState['clientProfiles'][$clientSlug] : [],
            $fallbackName
        );

        $profile = gp_update_state(function (array $state) use ($payload, $clientSlug, $isAdmin) {
            $fallbackName = gp_extract_client_name_by_slug($state['contractRegistry'], $clientSlug);
            $current = gp_ensure_client_profile($state, $clientSlug, $fallbackName);

            $next = $current;
            if ($isAdmin) {
                $next = array_merge($next, [
                    'billingStatus' => $payload['billingStatus'] ?? $current['billingStatus'],
                    'contractStartedAt' => $payload['contractStartedAt'] ?? $current['contractStartedAt'],
                    'contractEndedAt' => $payload['contractEndedAt'] ?? $current['contractEndedAt'],
                ]);
            }

            if (array_key_exists('seminar', $payload) && is_array($payload['seminar'])) {
                $next['seminar'] = array_merge(
                    is_array($current['seminar'] ?? null) ? $current['seminar'] : gp_blank_seminar_data(),
                    $payload['seminar']
                );
            }

            $next['name'] = $current['name'] ?: $fallbackName;
            $next['updatedAt'] = gp_now_iso();
            $next = gp_normalize_client_profile($clientSlug, $next, $fallbackName);
            $state['clientProfiles'][$clientSlug] = $next;

            return [$state, $next];
        });

        $afterState = gp_read_state();
        if (gp_has_client_profile_response($profile)) {
            gp_sync_profile_to_clickup($clientSlug, $profile, $afterState);
        }

        if (!$isAdmin && !empty($user['email']) && gp_has_client_profile_response($profile)) {
            $monthlyMarker = $clientSlug . ':' . gmdate('Y-m');
            if (!gp_has_notification_marker('client-form-response', $monthlyMarker)) {
                $sent = gp_send_email(
                    [gp_normalize_email((string)$user['email'])],
                    'Formulário respondido! Seu cadastro está ok.',
                    "Formulário respondido! Seu cadastro está ok. Utilize o sistema e sugira melhorias!\n\n"
                    . "Acesse seu portal:\n" . gp_get_client_portal_url($clientSlug) . "\n",
                    [
                        'event' => 'client_form_responded',
                        'clientSlug' => $clientSlug,
                        'userId' => $user['id'] ?? '',
                    ]
                );
                if ($sent) {
                    gp_claim_notification_marker('client-form-response', $monthlyMarker);
                }
            }
        }

        $billingBecameLate = $isAdmin
            && ($beforeProfile['billingStatus'] ?? 'current') !== 'late'
            && ($profile['billingStatus'] ?? 'current') === 'late';

        if ($billingBecameLate) {
            $recipients = gp_find_client_user_emails($afterState, $clientSlug);
            if ($recipients) {
                gp_send_email(
                    $recipients,
                    'Olá, verificamos aqui internamente e sua assinatura está atrasada.',
                    "Olá, verificamos aqui internamente e sua assinatura está atrasada.\n\n"
                    . "Entre no sistema para acompanhar seus dados e, se necessário, falar com a equipe:\n"
                    . gp_get_client_portal_url($clientSlug) . "\n",
                    [
                        'event' => 'billing_late',
                        'clientSlug' => $clientSlug,
                    ]
                );
            }
        }

        gp_json_response(['ok' => true, 'profile' => $profile]);
    }

    if ($action === 'save_rating') {
        gp_require_method('POST');
        $payload = gp_request_payload();
        $clientSlug = trim((string)($payload['clientSlug'] ?? ''));
        gp_require_client_access($clientSlug);
        $score = (int)($payload['score'] ?? 0);
        if ($score < 1 || $score > 10) {
            throw new RuntimeException('Nota inválida.');
        }

        $rating = gp_update_state(function (array $state) use ($payload, $clientSlug, $score) {
            $taskId = trim((string)($payload['taskId'] ?? ''));
            if ($taskId === '') {
                throw new RuntimeException('Task obrigatória.');
            }

            $service = gp_service_label_alias((string)($payload['service'] ?? ''));
            $employee = gp_normalize_entity_name((string)($payload['employee'] ?? ''));
            $revisionKey = trim((string)($payload['revisionKey'] ?? ($payload['resolvedAt'] ?? '')));
            $state['ratings'] = array_values(array_filter($state['ratings'], static function (array $item) use ($taskId): bool {
                return (string)($item['taskId'] ?? '') !== $taskId;
            }));

            $labels = [
                [1, 2, 'Péssimo'],
                [3, 4, 'Ruim'],
                [5, 6, 'Razoável'],
                [7, 8, 'Bom'],
                [9, 10, 'Excelente'],
            ];
            $label = '';
            foreach ($labels as [$min, $max, $text]) {
                if ($score >= $min && $score <= $max) {
                    $label = $text;
                    break;
                }
            }

            $rating = [
                'taskId' => $taskId,
                'taskName' => (string)($payload['taskName'] ?? ''),
                'clientSlug' => $clientSlug,
                'clientName' => (string)($payload['clientName'] ?? ''),
                'service' => $service,
                'employee' => $employee,
                'score' => $score,
                'label' => $label,
                'resolvedAt' => $payload['resolvedAt'] ?? null,
                'url' => (string)($payload['url'] ?? ''),
                'submittedAt' => gp_now_iso(),
            ];
            $state['ratings'][] = $rating;
            $state['taskReviews'] = array_values(array_filter($state['taskReviews'] ?? [], static function (array $item) use ($taskId, $revisionKey): bool {
                if ((string)($item['taskId'] ?? '') !== $taskId) {
                    return true;
                }

                return $revisionKey !== '' && (string)($item['revisionKey'] ?? '') !== $revisionKey;
            }));
            $state['taskReviews'][] = gp_normalize_task_review([
                'taskId' => $taskId,
                'taskName' => (string)($payload['taskName'] ?? ''),
                'clientSlug' => $clientSlug,
                'clientName' => (string)($payload['clientName'] ?? ''),
                'service' => $service,
                'employee' => $employee,
                'status' => 'approved',
                'notes' => '',
                'resolvedAt' => $payload['resolvedAt'] ?? null,
                'revisionKey' => $revisionKey,
                'url' => (string)($payload['url'] ?? ''),
                'submittedAt' => gp_now_iso(),
            ]);

            return [$state, $rating];
        });

        gp_json_response(['ok' => true, 'rating' => $rating]);
    }

    if ($action === 'save_task_review') {
        gp_require_method('POST');
        $payload = gp_request_payload();
        $clientSlug = trim((string)($payload['clientSlug'] ?? ''));
        gp_require_client_access($clientSlug);

        $status = (string)($payload['status'] ?? '');
        if (!in_array($status, ['approved', 'changes_requested'], true)) {
            throw new RuntimeException('Status de revisão inválido.');
        }

        $review = gp_update_state(function (array $state) use ($payload, $clientSlug, $status) {
            $taskId = trim((string)($payload['taskId'] ?? ''));
            if ($taskId === '') {
                throw new RuntimeException('Task obrigatória.');
            }

            $revisionKey = trim((string)($payload['revisionKey'] ?? ($payload['resolvedAt'] ?? '')));
            $review = gp_normalize_task_review([
                'taskId' => $taskId,
                'taskName' => (string)($payload['taskName'] ?? ''),
                'clientSlug' => $clientSlug,
                'clientName' => (string)($payload['clientName'] ?? ''),
                'service' => (string)($payload['service'] ?? ''),
                'employee' => (string)($payload['employee'] ?? ''),
                'status' => $status,
                'notes' => (string)($payload['notes'] ?? ''),
                'resolvedAt' => $payload['resolvedAt'] ?? null,
                'revisionKey' => $revisionKey,
                'url' => (string)($payload['url'] ?? ''),
                'submittedAt' => gp_now_iso(),
            ]);

            $state['taskReviews'] = array_values(array_filter($state['taskReviews'] ?? [], static function (array $item) use ($taskId, $revisionKey): bool {
                if ((string)($item['taskId'] ?? '') !== $taskId) {
                    return true;
                }

                return $revisionKey !== '' && (string)($item['revisionKey'] ?? '') !== $revisionKey;
            }));
            $state['taskReviews'][] = $review;

            return [$state, $review];
        });

        gp_json_response(['ok' => true, 'review' => $review]);
    }

    gp_json_response(['ok' => false, 'error' => 'Ação inválida.'], 404);
} catch (RuntimeException $error) {
    gp_json_response(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    gp_json_response(['ok' => false, 'error' => 'Erro interno no ambiente de insights.'], 500);
}

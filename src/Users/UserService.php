<?php

declare(strict_types=1);

namespace Diamantes\Users;

use Diamantes\Auth\PasswordHasher;
use Diamantes\Http\Request;

/**
 * User record normalization, sanitization, and mutation helpers.
 *
 * All logic is a direct extraction from api/bootstrap.php — behaviour is
 * bit-for-bit identical. No changes to validation rules, field names, or
 * document-type logic.
 */
final class UserService
{
    // ─── Static normalizers ───────────────────────────────────────────────────

    public static function normalizeEmail(string $value): string
    {
        return mb_strtolower(trim($value), 'UTF-8');
    }

    public static function normalizeIdentifier(string $value): string
    {
        return preg_replace('/\s+/', '', self::normalizeEmail($value)) ?? '';
    }

    public static function normalizeDocumentType(?string $value): string
    {
        return $value === 'cnpj' ? 'cnpj' : 'cpf';
    }

    public static function getDocumentLength(string $type): int
    {
        return self::normalizeDocumentType($type) === 'cnpj' ? 14 : 11;
    }

    public static function digitsOnly(string $value, int $maxLength): string
    {
        $digits = preg_replace('/\D+/', '', $value) ?? '';
        return substr($digits, 0, $maxLength);
    }

    public static function normalizeDocumentValue(string $type, string $value): string
    {
        return self::digitsOnly($value, self::getDocumentLength($type));
    }

    public static function inferDocumentType(string $value, string $fallback = 'cpf'): string
    {
        $digits = preg_replace('/\D+/', '', $value) ?? '';
        if (strlen($digits) === 14) {
            return 'cnpj';
        }
        if (strlen($digits) === 11) {
            return 'cpf';
        }
        return self::normalizeDocumentType($fallback);
    }

    /**
     * @param array<string, mixed> $user
     * @return array{type: string, value: string}
     */
    public static function getUserDocument(array $user): array
    {
        $storedValue = (string)($user['documentValue'] ?? $user['cpf'] ?? '');
        $type = self::inferDocumentType($storedValue, (string)($user['documentType'] ?? 'cpf'));
        return [
            'type' => $type,
            'value' => self::normalizeDocumentValue($type, $storedValue),
        ];
    }

    /**
     * @param array<string, mixed> $user
     */
    public static function isSeedAdminRecord(array $user): bool
    {
        return (string)($user['id'] ?? '') === 'seed-admin'
            || self::normalizeEmail((string)($user['email'] ?? '')) === 'admin';
    }

    /**
     * Normalize a user record to its canonical shape.
     *
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public static function normalize(array $user): array
    {
        $document = self::getUserDocument($user);
        $role = ($user['role'] ?? '') === 'admin' ? 'admin' : 'client';
        $status = in_array($user['status'] ?? '', ['pending', 'approved', 'rejected'], true)
            ? $user['status']
            : 'pending';
        $isSeedAdmin = self::isSeedAdminRecord($user);
        $normalized = [
            'id' => (string)($user['id'] ?? ''),
            'name' => trim((string)($user['name'] ?? '')),
            'email' => $isSeedAdmin ? 'admin' : self::normalizeEmail((string)($user['email'] ?? '')),
            'password' => (string)($user['password'] ?? ''),
            'documentType' => $isSeedAdmin ? 'cpf' : $document['type'],
            'documentValue' => $isSeedAdmin ? ($document['value'] ?: '00000000000') : $document['value'],
            'cpf' => $isSeedAdmin
                ? ($document['value'] ?: '00000000000')
                : ($document['type'] === 'cpf' ? $document['value'] : ''),
            'role' => $role,
            'status' => $role === 'admin' ? 'approved' : $status,
            'clientSlug' => $role === 'admin' ? '' : trim((string)($user['clientSlug'] ?? '')),
            'createdAt' => (string)($user['createdAt'] ?? Request::nowIso()),
            'updatedAt' => (string)($user['updatedAt'] ?? Request::nowIso()),
        ];

        if ($normalized['id'] === '') {
            $normalized['id'] = 'usr_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
        }

        return $normalized;
    }

    /**
     * Strip sensitive fields (password hash) before sending to client.
     *
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public static function publicUser(array $user): array
    {
        unset($user['password']);
        return $user;
    }

    /**
     * Apply a patch to a user record within $state, returning [$nextState, $updatedUser].
     *
     * @param array<string, mixed>  $state
     * @param array<string, mixed>  $patch
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    public static function updateRecord(array $state, string $userId, array $patch): array
    {
        $index = null;
        foreach ($state['users'] as $key => $user) {
            if (($user['id'] ?? '') === $userId) {
                $index = $key;
                break;
            }
        }

        if ($index === null) {
            throw new \RuntimeException('Usuário não encontrado.');
        }

        $current = $state['users'][$index];
        $next = $current;

        if (array_key_exists('name', $patch)) {
            $next['name'] = trim((string)$patch['name']);
            if ($next['name'] === '') {
                throw new \RuntimeException('Nome obrigatório.');
            }
        }

        if (array_key_exists('email', $patch)) {
            $nextEmail = self::normalizeEmail((string)$patch['email']);
            $nextRole = ($patch['role'] ?? $next['role'] ?? 'client') === 'admin' ? 'admin' : 'client';
            $isSeedAdmin = (string)$current['id'] === 'seed-admin'
                || ($nextRole === 'admin' && $nextEmail === 'admin');
            if (!$isSeedAdmin && ($nextEmail === '' || !str_contains($nextEmail, '@'))) {
                throw new \RuntimeException('Email inválido.');
            }

            foreach ($state['users'] as $user) {
                if (($user['id'] ?? '') === $userId) {
                    continue;
                }
                if (self::normalizeEmail((string)($user['email'] ?? '')) === $nextEmail) {
                    throw new \RuntimeException('Esse email já está em uso.');
                }
            }

            $next['email'] = $nextEmail;
        }

        if (array_key_exists('password', $patch)) {
            $rawPassword = (string)$patch['password'];
            if (mb_strlen($rawPassword, 'UTF-8') < 8) {
                throw new \RuntimeException('A senha precisa ter no mínimo 8 caracteres.');
            }
            $next['password'] = PasswordHasher::hash($rawPassword);
        }

        if (
            array_key_exists('documentType', $patch)
            || array_key_exists('documentValue', $patch)
            || array_key_exists('cpf', $patch)
        ) {
            $currentDocument = self::getUserDocument($next);
            $nextDocumentType = array_key_exists('documentType', $patch)
                ? self::normalizeDocumentType((string)$patch['documentType'])
                : $currentDocument['type'];
            $rawDocumentValue = array_key_exists('documentValue', $patch)
                ? (string)$patch['documentValue']
                : (array_key_exists('cpf', $patch) ? (string)$patch['cpf'] : $currentDocument['value']);
            $nextDocumentValue = self::normalizeDocumentValue($nextDocumentType, $rawDocumentValue);
            $nextRole = ($patch['role'] ?? $next['role'] ?? 'client') === 'admin' ? 'admin' : 'client';
            $nextEmail = array_key_exists('email', $patch)
                ? self::normalizeEmail((string)$patch['email'])
                : self::normalizeEmail((string)($next['email'] ?? ''));
            $isSeedAdmin = (string)$current['id'] === 'seed-admin'
                || ($nextRole === 'admin' && $nextEmail === 'admin');

            if (!$isSeedAdmin && strlen($nextDocumentValue) !== self::getDocumentLength($nextDocumentType)) {
                throw new \RuntimeException(($nextDocumentType === 'cnpj' ? 'CNPJ' : 'CPF') . ' inválido.');
            }

            $next['documentType'] = $nextDocumentType;
            $next['documentValue'] = $nextDocumentValue;
            $next['cpf'] = $nextDocumentType === 'cpf' ? $nextDocumentValue : '';
        }

        if (
            array_key_exists('status', $patch)
            && in_array($patch['status'], ['pending', 'approved', 'rejected'], true)
        ) {
            $next['status'] = $patch['status'];
        }

        if (array_key_exists('clientSlug', $patch)) {
            $next['clientSlug'] = trim((string)$patch['clientSlug']);
        }

        if (array_key_exists('role', $patch)) {
            $next['role'] = $patch['role'] === 'admin' ? 'admin' : 'client';
        }

        $next = self::normalize($next);
        $next['updatedAt'] = Request::nowIso();
        $state['users'][$index] = $next;

        return [$state, $next];
    }

    /**
     * Validate and extract registration input.
     *
     * @param array<string, mixed> $data
     * @return array{name: string, email: string, password: string, documentType: string, documentValue: string}
     */
    public static function validateRegistrationInput(array $data): array
    {
        $name = trim((string)($data['name'] ?? ''));
        $email = self::normalizeEmail((string)($data['email'] ?? ''));
        $password = (string)($data['password'] ?? '');
        $documentType = self::normalizeDocumentType((string)($data['documentType'] ?? 'cpf'));
        $rawDocument = (string)($data['documentValue'] ?? $data['document'] ?? $data['cpf'] ?? '');
        $documentValue = self::normalizeDocumentValue($documentType, $rawDocument);
        $label = $documentType === 'cnpj' ? 'CNPJ' : 'CPF';

        if ($name === '') {
            throw new \RuntimeException('Informe seu nome.');
        }
        if ($email === '' || !str_contains($email, '@')) {
            throw new \RuntimeException('Informe um email válido.');
        }
        if (mb_strlen($password, 'UTF-8') < 8) {
            throw new \RuntimeException('A senha precisa ter no mínimo 8 caracteres.');
        }
        if (strlen($documentValue) !== self::getDocumentLength($documentType)) {
            throw new \RuntimeException(sprintf(
                'Informe um %s válido com %d dígitos.',
                $label,
                self::getDocumentLength($documentType)
            ));
        }

        return [
            'name' => $name,
            'email' => $email,
            'password' => $password,
            'documentType' => $documentType,
            'documentValue' => $documentValue,
        ];
    }

    /**
     * Find a user by their session ID in the state array.
     *
     * @param array<string, mixed> $state
     * @return array<string, mixed>|null
     */
    public static function findById(array $state, string $userId): ?array
    {
        foreach ($state['users'] as $user) {
            if (($user['id'] ?? '') === $userId) {
                return $user;
            }
        }
        return null;
    }

    /**
     * Find a user by email/identifier in the state array.
     *
     * @param array<string, mixed> $state
     * @return array<string, mixed>|null
     */
    public static function findByIdentifier(array $state, string $identifier): ?array
    {
        $needle = self::normalizeIdentifier($identifier);
        if ($needle === '') {
            return null;
        }

        foreach ($state['users'] as $user) {
            if (self::normalizeIdentifier((string)($user['email'] ?? '')) === $needle) {
                return $user;
            }
        }
        return null;
    }

    /**
     * Return emails of approved clients for a given clientSlug.
     *
     * @param array<string, mixed> $state
     * @return string[]
     */
    public static function findClientUserEmails(array $state, string $clientSlug): array
    {
        $emails = [];
        foreach (($state['users'] ?? []) as $user) {
            if (
                ($user['role'] ?? '') === 'client'
                && ($user['status'] ?? '') === 'approved'
                && ($user['clientSlug'] ?? '') === trim($clientSlug)
                && !empty($user['email'])
            ) {
                $emails[] = self::normalizeEmail((string)$user['email']);
            }
        }
        return array_values(array_unique(array_filter($emails)));
    }
}

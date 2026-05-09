<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Security;

use PHPUnit\Framework\TestCase;

/**
 * CRITICAL-2 regression: gp_normalize_state() must preserve the stored password
 * (user record wins over defaults via array_merge order in bootstrap.php:684).
 *
 * If array_merge($admin, $user) is ever flipped to array_merge($user, $admin),
 * the admin defaults would overwrite the stored password with '' and this test
 * would catch it immediately.
 */
final class NormalizeStateTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        if (!function_exists('gp_normalize_state')) {
            $_SERVER['REQUEST_METHOD'] = 'GET';
            require_once dirname(__DIR__, 3) . '/api/bootstrap.php';
        }
    }

    public function testNormalizeStatePreservesStoredPassword(): void
    {
        // A realistic bcrypt hash (cost 12, valid format).
        $bcryptHash = '$2y$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

        $state = [
            'users' => [
                [
                    'id'            => 'seed-admin',
                    'name'          => 'Administrador',
                    'email'         => 'admin@grupoparticipa.com.br',
                    'password'      => $bcryptHash,
                    'role'          => 'admin',
                    'status'        => 'approved',
                    'documentType'  => 'cpf',
                    'documentValue' => '00000000000',
                ],
            ],
        ];

        $normalized = gp_normalize_state($state);

        $seedAdmin = null;
        foreach ($normalized['users'] as $user) {
            if (($user['id'] ?? '') === 'seed-admin') {
                $seedAdmin = $user;
                break;
            }
        }

        $this->assertNotNull($seedAdmin, 'seed-admin must be present after normalization');

        // Bit-for-bit preservation — any mutation fails this assertion.
        $this->assertSame(
            $bcryptHash,
            $seedAdmin['password'],
            'Stored password must survive normalize_state unchanged (user record wins over defaults)'
        );

        // Sentinel values must never replace a real hash.
        $this->assertNotSame('', $seedAdmin['password'], 'Password must not be reset to sentinel empty string');
        $this->assertNotSame('12345678', $seedAdmin['password'], 'Password must not be a plaintext default');
    }
}

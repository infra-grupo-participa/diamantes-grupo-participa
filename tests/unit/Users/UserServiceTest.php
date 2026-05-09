<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Users;

use Diamantes\Users\UserService;
use PHPUnit\Framework\TestCase;

final class UserServiceTest extends TestCase
{
    // ─── normalizeEmail ───────────────────────────────────────────────────────

    public function testNormalizeEmailLowercasesAndTrims(): void
    {
        $this->assertSame('user@example.com', UserService::normalizeEmail('  USER@EXAMPLE.COM  '));
    }

    public function testNormalizeIdentifierStripsSpaces(): void
    {
        $this->assertSame('user@example.com', UserService::normalizeIdentifier(' User @ Example . Com '));
    }

    // ─── document helpers ─────────────────────────────────────────────────────

    public function testNormalizeDocumentTypeCpfDefault(): void
    {
        $this->assertSame('cpf', UserService::normalizeDocumentType(null));
        $this->assertSame('cpf', UserService::normalizeDocumentType('cpf'));
        $this->assertSame('cpf', UserService::normalizeDocumentType('other'));
    }

    public function testNormalizeDocumentTypeCnpj(): void
    {
        $this->assertSame('cnpj', UserService::normalizeDocumentType('cnpj'));
    }

    public function testGetDocumentLength(): void
    {
        $this->assertSame(11, UserService::getDocumentLength('cpf'));
        $this->assertSame(14, UserService::getDocumentLength('cnpj'));
    }

    public function testDigitsOnlyStripsNonDigits(): void
    {
        $this->assertSame('12345', UserService::digitsOnly('1.2-3/4 5abc', 10));
    }

    public function testDigitsOnlyRespectsMaxLength(): void
    {
        $this->assertSame('123', UserService::digitsOnly('12345', 3));
    }

    public function testInferDocumentTypeCpf11Digits(): void
    {
        $this->assertSame('cpf', UserService::inferDocumentType('12345678901'));
    }

    public function testInferDocumentTypeCnpj14Digits(): void
    {
        $this->assertSame('cnpj', UserService::inferDocumentType('12345678000195'));
    }

    public function testInferDocumentTypeFallback(): void
    {
        $this->assertSame('cnpj', UserService::inferDocumentType('abc', 'cnpj'));
    }

    // ─── isSeedAdminRecord ────────────────────────────────────────────────────

    public function testIsSeedAdminById(): void
    {
        $this->assertTrue(UserService::isSeedAdminRecord(['id' => 'seed-admin']));
    }

    public function testIsSeedAdminByEmail(): void
    {
        $this->assertTrue(UserService::isSeedAdminRecord(['email' => 'admin']));
    }

    public function testIsNotSeedAdmin(): void
    {
        $this->assertFalse(UserService::isSeedAdminRecord(['id' => 'usr_123', 'email' => 'user@example.com']));
    }

    // ─── normalize ────────────────────────────────────────────────────────────

    public function testNormalizeGeneratesIdWhenEmpty(): void
    {
        $user = UserService::normalize([
            'name' => 'Test',
            'email' => 'test@example.com',
            'password' => 'hash',
            'role' => 'client',
            'status' => 'pending',
            'documentType' => 'cpf',
            'documentValue' => '12345678901',
        ]);
        $this->assertStringStartsWith('usr_', $user['id']);
    }

    public function testNormalizeAdminRoleOverridesStatus(): void
    {
        $user = UserService::normalize([
            'id' => 'usr_1',
            'name' => 'Admin',
            'email' => 'adm@example.com',
            'password' => '',
            'role' => 'admin',
            'status' => 'pending', // Should be overridden to 'approved' for admin.
        ]);
        $this->assertSame('approved', $user['status']);
    }

    public function testNormalizeClientStatusPreserved(): void
    {
        $user = UserService::normalize([
            'id' => 'usr_2',
            'name' => 'Client',
            'email' => 'client@example.com',
            'password' => '',
            'role' => 'client',
            'status' => 'approved',
        ]);
        $this->assertSame('approved', $user['status']);
    }

    // ─── publicUser ───────────────────────────────────────────────────────────

    public function testPublicUserStripsPassword(): void
    {
        $user = ['id' => 'usr_1', 'name' => 'Test', 'password' => 'bcrypt-hash'];
        $public = UserService::publicUser($user);
        $this->assertArrayNotHasKey('password', $public);
        $this->assertArrayHasKey('id', $public);
    }

    // ─── findById / findByIdentifier ─────────────────────────────────────────

    public function testFindByIdReturnsMatchingUser(): void
    {
        $state = ['users' => [
            ['id' => 'usr_1', 'email' => 'a@example.com'],
            ['id' => 'usr_2', 'email' => 'b@example.com'],
        ]];
        $found = UserService::findById($state, 'usr_2');
        $this->assertNotNull($found);
        $this->assertSame('usr_2', $found['id']);
    }

    public function testFindByIdReturnsNullWhenMissing(): void
    {
        $state = ['users' => [['id' => 'usr_1', 'email' => 'a@example.com']]];
        $this->assertNull(UserService::findById($state, 'nonexistent'));
    }

    public function testFindByIdentifierMatchesByEmail(): void
    {
        $state = ['users' => [
            ['id' => 'usr_1', 'email' => 'user@example.com'],
        ]];
        $found = UserService::findByIdentifier($state, 'USER@EXAMPLE.COM');
        $this->assertNotNull($found);
        $this->assertSame('usr_1', $found['id']);
    }

    public function testFindByIdentifierReturnsNullForEmpty(): void
    {
        $state = ['users' => []];
        $this->assertNull(UserService::findByIdentifier($state, ''));
    }

    // ─── validateRegistrationInput ────────────────────────────────────────────

    public function testValidRegistrationInput(): void
    {
        $result = UserService::validateRegistrationInput([
            'name' => 'João Silva',
            'email' => 'joao@example.com',
            'password' => 'senha1234',
            'documentType' => 'cpf',
            'documentValue' => '12345678901',
        ]);
        $this->assertSame('João Silva', $result['name']);
        $this->assertSame('joao@example.com', $result['email']);
    }

    public function testValidationRequiresName(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Informe seu nome');
        UserService::validateRegistrationInput([
            'name' => '',
            'email' => 'joao@example.com',
            'password' => 'senha1234',
            'documentType' => 'cpf',
            'documentValue' => '12345678901',
        ]);
    }

    public function testValidationRequiresValidEmail(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('email');
        UserService::validateRegistrationInput([
            'name' => 'Test',
            'email' => 'not-an-email',
            'password' => 'senha1234',
            'documentType' => 'cpf',
            'documentValue' => '12345678901',
        ]);
    }

    public function testValidationRequiresMinimumPasswordLength(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('8 caracteres');
        UserService::validateRegistrationInput([
            'name' => 'Test',
            'email' => 'test@example.com',
            'password' => 'short',
            'documentType' => 'cpf',
            'documentValue' => '12345678901',
        ]);
    }

    // ─── findClientUserEmails ─────────────────────────────────────────────────

    public function testFindClientUserEmailsReturnsApprovedClients(): void
    {
        $state = ['users' => [
            ['role' => 'client', 'status' => 'approved', 'clientSlug' => 'bruno-couto', 'email' => 'a@test.com'],
            ['role' => 'client', 'status' => 'pending', 'clientSlug' => 'bruno-couto', 'email' => 'b@test.com'],
            ['role' => 'client', 'status' => 'approved', 'clientSlug' => 'other-slug', 'email' => 'c@test.com'],
        ]];
        $emails = UserService::findClientUserEmails($state, 'bruno-couto');
        $this->assertSame(['a@test.com'], $emails);
    }
}

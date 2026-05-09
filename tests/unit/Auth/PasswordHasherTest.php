<?php

declare(strict_types=1);

namespace Diamantes\Tests\Unit\Auth;

use Diamantes\Auth\PasswordHasher;
use PHPUnit\Framework\TestCase;

final class PasswordHasherTest extends TestCase
{
    public function testHashProducesBcryptHash(): void
    {
        $hash = PasswordHasher::hash('hunter2');
        $this->assertStringStartsWith('$2', $hash, 'Hash must start with bcrypt prefix');
    }

    public function testHashCostIsAtLeast12(): void
    {
        $hash = PasswordHasher::hash('hunter2');
        $info = password_get_info($hash);
        $this->assertGreaterThanOrEqual(12, $info['options']['cost'] ?? 0);
    }

    public function testVerifyReturnsTrueForMatchingPassword(): void
    {
        $hash = PasswordHasher::hash('correct');
        $this->assertTrue(PasswordHasher::verify('correct', $hash));
    }

    public function testVerifyReturnsFalseForWrongPassword(): void
    {
        $hash = PasswordHasher::hash('correct');
        $this->assertFalse(PasswordHasher::verify('wrong', $hash));
    }

    public function testVerifyReturnsFalseForEmptyStored(): void
    {
        $this->assertFalse(PasswordHasher::verify('anything', ''));
    }

    public function testVerifyReturnsFalseForEmptyInput(): void
    {
        $hash = PasswordHasher::hash('real');
        $this->assertFalse(PasswordHasher::verify('', $hash));
    }

    public function testVerifyLegacyPlaintextWithHashEquals(): void
    {
        // Plaintext stored (legacy migration path).
        $this->assertTrue(PasswordHasher::verify('legacy123', 'legacy123'));
    }

    public function testVerifyLegacyPlaintextRejectsWrong(): void
    {
        $this->assertFalse(PasswordHasher::verify('wrong', 'legacy123'));
    }

    public function testNeedsRehashReturnsFalseForBcrypt(): void
    {
        $hash = PasswordHasher::hash('test');
        $this->assertFalse(PasswordHasher::needsRehash($hash));
    }

    public function testNeedsRehashReturnsTrueForPlaintext(): void
    {
        $this->assertTrue(PasswordHasher::needsRehash('plaintext'));
    }

    public function testNeedsRehashReturnsFalseForEmpty(): void
    {
        $this->assertFalse(PasswordHasher::needsRehash(''));
    }
}

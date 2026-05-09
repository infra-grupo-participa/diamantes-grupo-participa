<?php

declare(strict_types=1);

namespace Diamantes;

/**
 * Placeholder until Phase 2 extracts classes from api/bootstrap.php into this src/ tree.
 *
 * Keeping a real PSR-4 class here makes the PHPUnit coverage filter resolvable
 * (it warns + exits non-zero when its <source> directory has no PHP files).
 */
final class Placeholder
{
    public static function version(): string
    {
        return '0.0.0-phase-0';
    }
}

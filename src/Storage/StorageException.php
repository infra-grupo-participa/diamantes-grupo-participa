<?php

declare(strict_types=1);

namespace Diamantes\Storage;

use RuntimeException;

/**
 * Thrown by any StorageDriver implementation when a persistence operation fails.
 * Wraps driver-specific exceptions so callers are not coupled to the driver.
 */
final class StorageException extends RuntimeException
{
}

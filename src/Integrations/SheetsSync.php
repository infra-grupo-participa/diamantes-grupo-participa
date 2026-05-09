<?php

declare(strict_types=1);

namespace Diamantes\Integrations;

/**
 * Google Apps Script / Sheets sync integration.
 *
 * Wraps the outbound POST to GP_SHEETS_SYNC_URL with HMAC secret header.
 */
final class SheetsSync
{
    private string $syncUrl;
    private string $syncSecret;

    public function __construct(string $syncUrl, string $syncSecret)
    {
        $this->syncUrl = $syncUrl;
        $this->syncSecret = $syncSecret;
    }

    public function getSyncUrl(): string
    {
        return $this->syncUrl;
    }

    public function getSyncSecret(): string
    {
        return $this->syncSecret;
    }

    /**
     * Return config from environment variables.
     *
     * These are static helpers so the Container can build the instance.
     */
    public static function urlFromEnv(): string
    {
        return trim((string)(
            getenv('GP_SHEETS_SYNC_URL')
            ?: getenv('GOOGLE_APPS_SCRIPT_WEBHOOK_URL')
            ?: ''
        ));
    }

    public static function secretFromEnv(): string
    {
        return trim((string)(getenv('GP_SHEETS_SYNC_SECRET') ?: getenv('GOOGLE_APPS_SCRIPT_SECRET') ?: ''));
    }
}

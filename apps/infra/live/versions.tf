terraform {
  required_version = "1.13.2"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.27.0"
    }
    infisical = {
      source  = "infisical/infisical"
      version = "0.19.38"
    }
  }

  backend "s3" {
    region                      = "auto"
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }

    state {
      method   = method.aes_gcm.state
      enforced = true
    }

    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}

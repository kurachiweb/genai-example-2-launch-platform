mock_provider "cloudflare" {}

variables {
  account_id = "00000000000000000000000000000000"
  zone_id    = "00000000000000000000000000000000"
  turnstile = {
    name    = "app-staging"
    domains = ["app-client-staging.example", "app-admin-staging.example"]
    mode    = "invisible"
  }
  web_analytics_host   = "app-client-staging.example"
  email_sending_domain = "app-mail-staging.example"
}

run "plans_one_invisible_turnstile_widget_for_given_hostnames" {
  command = plan

  assert {
    condition     = cloudflare_turnstile_widget.this.account_id == var.account_id && cloudflare_turnstile_widget.this.name == var.turnstile.name
    error_message = "Turnstileのウィジェットのアカウントまたは名前が資源一覧と一致しない"
  }

  assert {
    condition     = cloudflare_turnstile_widget.this.domains == tolist(var.turnstile.domains)
    error_message = "Turnstileのウィジェットの対象のホスト名が資源一覧と一致しない"
  }

  assert {
    condition     = cloudflare_turnstile_widget.this.mode == "invisible"
    error_message = "Turnstileのウィジェットのモードが非表示(invisible)でない"
  }

  assert {
    condition     = cloudflare_turnstile_widget.this.region == "world"
    error_message = "Turnstileのウィジェットの利用地域がworldでない"
  }
}

run "plans_web_analytics_site_for_given_host_without_auto_install" {
  command = plan

  assert {
    condition     = cloudflare_web_analytics_site.this.account_id == var.account_id && cloudflare_web_analytics_site.this.host == var.web_analytics_host
    error_message = "アクセス解析のサイトのアカウントまたはホスト名が資源一覧と一致しない"
  }

  assert {
    condition     = cloudflare_web_analytics_site.this.auto_install == false
    error_message = "アクセス解析のスクリプトの自動挿入が無効になっていない"
  }

  assert {
    condition     = cloudflare_web_analytics_site.this.zone_tag == null
    error_message = "アクセス解析のサイトがゾーンに紐づいている"
  }
}

run "plans_email_sending_subdomain_without_preview_and_keeps_suppressed_recipients_rejected" {
  command = plan

  assert {
    condition     = cloudflare_email_sending_subdomain.this.zone_id == var.zone_id && cloudflare_email_sending_subdomain.this.name == var.email_sending_domain
    error_message = "送信ドメインのゾーンまたは名前が資源一覧と一致しない"
  }

  assert {
    condition     = cloudflare_email_sending_subdomain.this.preview_enabled == false
    error_message = "送信ドメインのプレビューの保存が無効になっていない"
  }

  assert {
    condition     = cloudflare_email_sending_subdomain.this.drop_suppressed_recipients == false
    error_message = "抑止中の宛先を含む送信が失敗せず、宛先が黙って除かれる設定になっている"
  }
}

run "rejects_managed_turnstile_mode" {
  command = plan

  variables {
    turnstile = {
      name    = "app-staging"
      domains = ["app-client-staging.example", "app-admin-staging.example"]
      mode    = "managed"
    }
  }

  expect_failures = [var.turnstile]
}

run "reports_account_zone_and_hosts_of_planned_resources" {
  command = plan

  variables {
    account_id = "0123456789abcdef0123456789abcdef"
    zone_id    = "fedcba9876543210fedcba9876543210"
  }

  assert {
    condition = output.placement == {
      account_ids          = toset(["0123456789abcdef0123456789abcdef"])
      zone_ids             = toset(["fedcba9876543210fedcba9876543210"])
      web_analytics_host   = "app-client-staging.example"
      email_sending_domain = "app-mail-staging.example"
    }
    error_message = "bot判定・アクセス解析・メール送信の計画のアカウント・ゾーン・ホスト名・送信ドメインが出力placementに現れない"
  }
}

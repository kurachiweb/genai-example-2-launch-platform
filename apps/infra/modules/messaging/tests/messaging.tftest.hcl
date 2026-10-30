mock_provider "cloudflare" {}

variables {
  account_id   = "00000000000000000000000000000000"
  jurisdiction = "us"
  queues = {
    jobs         = { name = "app-jobs-staging" }
    jobs-dlq     = { name = "app-jobs-dlq-staging" }
    email-events = { name = "app-email-events-staging" }
  }
}

run "plans_one_queue_per_catalog_entry" {
  command = plan

  assert {
    condition     = length(cloudflare_queue.this) == length(var.queues)
    error_message = "Queueの数が資源一覧の項目数と一致しない"
  }

  assert {
    condition     = alltrue([for k, q in cloudflare_queue.this : q.queue_name == var.queues[k].name && q.account_id == var.account_id])
    error_message = "Queueの名前またはアカウントが資源一覧と一致しない"
  }

  assert {
    condition     = toset(keys(output.queue_ids)) == toset(keys(var.queues))
    error_message = "Queueの識別子の出力のキーが資源一覧のキーと一致しない"
  }
}

run "places_every_queue_in_us_jurisdiction" {
  command = plan

  assert {
    condition     = alltrue([for q in cloudflare_queue.this : q.jurisdiction == "us"])
    error_message = "Queueの管轄が米国でない"
  }
}

run "adds_queues_by_adding_catalog_entries" {
  command = plan

  variables {
    queues = {
      jobs         = { name = "app-jobs-staging" }
      jobs-dlq     = { name = "app-jobs-dlq-staging" }
      email-events = { name = "app-email-events-staging" }
      exports      = { name = "app-exports-staging" }
    }
  }

  assert {
    condition     = length(cloudflare_queue.this) == 4
    error_message = "資源一覧に加えたQueueが計画されない"
  }

  assert {
    condition     = cloudflare_queue.this["exports"].jurisdiction == "us"
    error_message = "資源一覧に加えたQueueの管轄が米国でない"
  }
}

run "rejects_default_jurisdiction" {
  command = plan

  variables {
    jurisdiction = "default"
  }

  expect_failures = [var.jurisdiction]
}

run "rejects_empty_jurisdiction" {
  command = plan

  variables {
    jurisdiction = ""
  }

  expect_failures = [var.jurisdiction]
}

run "reports_account_and_jurisdiction_of_planned_queues" {
  command = plan

  variables {
    account_id = "0123456789abcdef0123456789abcdef"
  }

  assert {
    condition = output.placement == {
      account_ids   = toset(["0123456789abcdef0123456789abcdef"])
      jurisdictions = toset(["us"])
    }
    error_message = "Queueの計画のアカウントと管轄が出力placementに現れない"
  }
}

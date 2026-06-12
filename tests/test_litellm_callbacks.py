from __future__ import annotations


def test_strip_openrouter_prefix() -> None:
    import litellm_callbacks

    assert litellm_callbacks._strip_openrouter_prefix("openrouter/anthropic/model") == "anthropic/model"
    assert litellm_callbacks._strip_openrouter_prefix("openrouter/model") == "openrouter/model"
    assert litellm_callbacks._strip_openrouter_prefix("anthropic/model") == "anthropic/model"


def test_dedupe_openrouter_tool_use_ids_updates_results() -> None:
    import litellm_callbacks

    messages = [
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "working"},
                {"type": "tool_use", "id": "call_1", "name": "first", "input": {}},
                {"type": "tool_use", "id": "call_1", "name": "second", "input": {}},
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "call_1", "content": "first"},
                {"type": "tool_result", "tool_use_id": "call_1", "content": "second"},
            ],
        },
    ]

    normalized = litellm_callbacks._dedupe_openrouter_tool_use_ids(messages)

    tool_use_blocks = normalized[0]["content"][1:]
    tool_result_blocks = normalized[1]["content"]
    assert [block["id"] for block in tool_use_blocks] == ["call_1", "call_1-2"]
    assert [block["tool_use_id"] for block in tool_result_blocks] == [
        "call_1",
        "call_1-2",
    ]
    assert messages[0]["content"][2]["id"] == "call_1"


def test_dedupe_openrouter_tool_call_ids_updates_tool_messages() -> None:
    import litellm_callbacks

    messages = [
        {
            "role": "assistant",
            "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "a"}},
                {"id": "call_1", "type": "function", "function": {"name": "b"}},
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "first"},
        {"role": "tool", "tool_call_id": "call_1", "content": "second"},
    ]

    normalized = litellm_callbacks._dedupe_openrouter_tool_use_ids(messages)

    assert [call["id"] for call in normalized[0]["tool_calls"]] == [
        "call_1",
        "call_1-2",
    ]
    assert [message["tool_call_id"] for message in normalized[1:]] == [
        "call_1",
        "call_1-2",
    ]


def test_merge_header_sources_precedence() -> None:
    import litellm_callbacks

    headers = litellm_callbacks._merge_header_sources(
        {
            "proxy_server_request": {"headers": {"A": "1", "B": "proxy"}},
            "optional_params": {"extra_headers": {"B": "optional", "C": "2"}},
            "litellm_params": {"extra_headers": {"D": "3"}},
        }
    )

    assert headers == {"A": "1", "B": "optional", "C": "2", "D": "3"}


def test_sanitize_sampling_params_for_azure_models() -> None:
    import litellm_callbacks

    payload = {
        "model": "azure_ai/claude-sonnet-4-5",
        "temperature": 0.3,
        "top_p": 0.95,
    }
    changed = litellm_callbacks._sanitize_sampling_params(payload)

    assert changed is True
    assert payload["temperature"] == 0.3
    assert "top_p" not in payload


def test_sanitize_sampling_params_noop_when_no_top_p() -> None:
    import litellm_callbacks

    payload = {
        "model": "claude-sonnet-4-5",
        "temperature": 0.3,
    }
    changed = litellm_callbacks._sanitize_sampling_params(payload)

    assert changed is False
    assert payload == {
        "model": "claude-sonnet-4-5",
        "temperature": 0.3,
    }


def test_sanitize_sampling_params_noop_for_non_azure() -> None:
    import litellm_callbacks

    payload = {
        "model": "openrouter/anthropic/claude-opus-4.8",
        "temperature": 0.3,
        "top_p": 0.95,
    }
    changed = litellm_callbacks._sanitize_sampling_params(payload)

    assert changed is True
    assert "top_p" not in payload


def test_sanitize_sampling_params_nested_payload_shape() -> None:
    import litellm_callbacks

    payload = {
        "model_group": "azure_ai/claude-sonnet-4-5",
        "request": {
            "generation_config": {"temperature": 0.2, "top_p": 0.9},
            "optional_params": {"top_p": 0.95},
        },
    }

    changed = litellm_callbacks._sanitize_sampling_params(
        payload, model_hint="azure_ai/claude-sonnet-4-5"
    )

    assert changed is True
    assert payload["request"]["generation_config"]["temperature"] == 0.2
    assert "top_p" not in payload["request"]["generation_config"]
    assert "top_p" not in payload["request"]["optional_params"]


def test_drop_top_p_removes_nested_entries() -> None:
    import litellm_callbacks

    payload = {
        "top_p": 0.9,
        "optional_params": {
            "top_p": 0.95,
            "inner": [{"top_p": 0.2}, {"keep": True}],
        },
    }

    litellm_callbacks._drop_top_p(payload)

    assert "top_p" not in payload
    assert "top_p" not in payload["optional_params"]
    assert "top_p" not in payload["optional_params"]["inner"][0]


def test_proxy_callback_records_expert_cost(active_project: str) -> None:
    import litellm_callbacks
    from kady_agent import runtime

    callback = litellm_callbacks.OpenRouterPrefixFix()
    callback._record(
        {
            "model": "openrouter/vendor/model",
            "response_cost": 0.02,
            "proxy_server_request": {
                "headers": runtime.build_tracking_headers(
                    role="expert",
                    project_id=active_project,
                    session_id="session-proxy",
                    turn_id="turn-proxy",
                    delegation_id="001",
                )
            },
        },
        {"usage": {"prompt_tokens": 4, "completion_tokens": 5}},
    )

    summary = runtime.read_costs("session-proxy", project_id=active_project)
    assert summary["expertUsd"] == 0.02
    assert summary["entries"][0]["delegationId"] == "001"


def test_proxy_callback_ignores_non_expert(active_project: str) -> None:
    import litellm_callbacks
    from kady_agent import runtime

    callback = litellm_callbacks.OpenRouterPrefixFix()
    callback._record(
        {
            "model": "openrouter/vendor/model",
            "response_cost": 0.02,
            "proxy_server_request": {
                "headers": runtime.build_tracking_headers(
                    role="orchestrator",
                    project_id=active_project,
                    session_id="session-noop",
                    turn_id="turn",
                )
            },
        },
        {"usage": {}},
    )

    assert runtime.read_costs("session-noop", project_id=active_project)["entries"] == []


def test_proxy_callback_records_gemini_alias_cost(active_project: str) -> None:
    import litellm_callbacks
    from kady_agent import runtime

    callback = litellm_callbacks.OpenRouterPrefixFix()
    callback._record(
        {
            "model": "gemini-3-pro-preview",
            "response_cost": 0.01,
            "proxy_server_request": {
                "headers": runtime.build_tracking_headers(
                    role="expert",
                    project_id=active_project,
                    session_id="session-gemini-proxy",
                    turn_id="turn",
                )
            },
        },
        {"usage": {"prompt_tokens": 1, "completion_tokens": 1}},
    )

    assert (
        runtime.read_costs("session-gemini-proxy", project_id=active_project)["expertUsd"]
        == 0.01
    )


def test_google_genai_success_log_patch_skips_missing_httpx_response(monkeypatch) -> None:
    import litellm_callbacks

    marker = {"ok": True}

    def _raise_missing_httpx(self, result):
        raise ValueError("Google GenAI Generate Content: httpx_response is None")

    monkeypatch.setattr(
        litellm_callbacks,
        "_ORIG_GOOGLE_GENAI_NON_STREAMING_SUCCESS_LOG",
        _raise_missing_httpx,
    )

    output = litellm_callbacks._patched_google_genai_non_streaming_success_log(
        object(), marker
    )
    assert output is marker


def test_google_genai_success_log_patch_keeps_other_errors(monkeypatch) -> None:
    import litellm_callbacks

    def _raise_other(self, result):
        raise ValueError("different error")

    monkeypatch.setattr(
        litellm_callbacks,
        "_ORIG_GOOGLE_GENAI_NON_STREAMING_SUCCESS_LOG",
        _raise_other,
    )

    try:
        litellm_callbacks._patched_google_genai_non_streaming_success_log(
            object(), {"ok": True}
        )
    except ValueError as exc:
        assert str(exc) == "different error"
    else:
        raise AssertionError("expected ValueError to be re-raised")

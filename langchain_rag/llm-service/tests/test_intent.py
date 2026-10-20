from datetime import date

import pytest

from app.intent import NO_INTENT, reply_hint, validate
from app.schemas import BookAction, SimpleAction

TODAY = date(2026, 10, 19)


def book(**overrides):
    raw = {
        "intent": "BOOK",
        "hotel": "seoul",
        "roomName": "디럭스 더블룸",
        "checkIn": "2026-10-23",
        "checkOut": "2026-10-25",
        "adults": 2,
        "children": 0,
    }
    raw.update(overrides)
    return raw


def test_complete_book_produces_action():
    result = validate(book(), TODAY)
    assert result.intent == "BOOK"
    assert result.missing == []
    assert result.action == BookAction(
        hotel="seoul", roomName="디럭스 더블룸", checkIn="2026-10-23", checkOut="2026-10-25", adults=2, children=0
    )


@pytest.mark.parametrize("raw", [None, "BOOK", [], {"intent": "REFUND_ALL"}, {"intent": "LOGIN_REQUIRED"}, {}])
def test_unknown_or_malformed_intent_is_dropped(raw):
    assert validate(raw, TODAY) == NO_INTENT


@pytest.mark.parametrize("intent", ["PAY", "CANCEL"])
def test_pay_and_cancel_carry_no_fields(intent):
    # 예약 ID나 URL을 끼워 넣어도 type만 남습니다.
    result = validate({"intent": intent, "reservationId": 5, "url": "https://evil.example"}, TODAY)
    assert result.action == SimpleAction(type=intent)
    assert result.action.model_dump() == {"type": intent}


def test_unknown_hotel_is_missing():
    result = validate(book(hotel="https://evil.example"), TODAY)
    assert result.action is None
    assert result.missing == ["hotel"]


@pytest.mark.parametrize(
    "check_in,check_out",
    [
        ("2026-10-18", "2026-10-20"),  # 과거
        ("2026-10-25", "2026-10-23"),  # 순서 역전
        ("2026-10-23", "2026-10-23"),  # 0박
        ("2026-10-23", "2027-10-21"),  # 365일 초과
        ("2026-13-01", "2026-13-03"),  # 없는 날짜
        ("20261023", "20261025"),  # 형식 오류
        (None, "2026-10-25"),
    ],
)
def test_invalid_dates_are_missing(check_in, check_out):
    result = validate(book(checkIn=check_in, checkOut=check_out), TODAY)
    assert result.action is None
    assert result.missing == ["checkIn", "checkOut"]


def test_room_name_must_belong_to_hotel():
    # 부산점 객실명을 서울점으로 요청하면 객실만 비우고 예약 카드는 유지합니다.
    result = validate(book(roomName="오션뷰 스위트룸"), TODAY)
    assert result.action.roomName is None


@pytest.mark.parametrize("adults,expected", [(None, 2), (0, 2), (11, 2), (True, 2), ("3", 2), (3, 3)])
def test_adults_default_and_bounds(adults, expected):
    assert validate(book(adults=adults), TODAY).action.adults == expected


@pytest.mark.parametrize("children,expected", [(None, 0), (-1, 0), (11, 0), (2, 2)])
def test_children_bounds(children, expected):
    assert validate(book(children=children), TODAY).action.children == expected


def test_hint_none_without_intent():
    assert reply_hint(NO_INTENT, authenticated=True) is None


@pytest.mark.parametrize("raw", [book(), book(hotel=None), {"intent": "PAY"}, {"intent": "CANCEL"}])
def test_hint_asks_to_login_when_anonymous(raw):
    hint = reply_hint(validate(raw, TODAY), authenticated=False)
    assert "not logged in" in hint
    assert "Do not ask" in hint


def test_hint_asks_for_missing_slots():
    hint = reply_hint(validate(book(hotel=None, checkIn=None), TODAY), authenticated=True)
    assert "지점" in hint and "체크인 날짜" in hint


def test_hint_mentions_button_when_complete():
    hint = reply_hint(validate(book(), TODAY), authenticated=True)
    assert "서울점" in hint and "button" in hint

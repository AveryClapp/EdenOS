from backend.scheduler.circadian import build_energy_defaults


def test_returns_168_entries():
    result = build_energy_defaults(wake_hour=7)
    assert len(result) == 7 * 24


def test_all_seven_days_present():
    result = build_energy_defaults(wake_hour=7)
    days = {e["day_of_week"] for e in result}
    assert days == {0, 1, 2, 3, 4, 5, 6}


def test_all_24_hours_per_day():
    result = build_energy_defaults(wake_hour=7)
    for day in range(7):
        hours = [e["hour_of_day"] for e in result if e["day_of_week"] == day]
        assert sorted(hours) == list(range(24))


def test_peak_window_is_5():
    # wake_hour=7 → peak window is 9,10,11 (offsets 2,3,4)
    result = build_energy_defaults(wake_hour=7)
    peak_hours = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (9, 10, 11)]
    assert all(e["energy_level"] == 5 for e in peak_hours)


def test_nadir_is_2():
    # wake_hour=7 → nadir is 14,15 (offsets 7,8)
    result = build_energy_defaults(wake_hour=7)
    nadir_hours = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (14, 15)]
    assert all(e["energy_level"] == 2 for e in nadir_hours)


def test_secondary_peak_is_4():
    # wake_hour=7 → secondary peak is 16,17 (offsets 9,10)
    result = build_energy_defaults(wake_hour=7)
    secondary = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (16, 17)]
    assert all(e["energy_level"] == 4 for e in secondary)


def test_pre_wake_is_1():
    # wake_hour=7 → hours 0-6 (offsets 17-23 via modular arithmetic → default=1)
    result = build_energy_defaults(wake_hour=7)
    pre_wake = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in range(1, 7)]
    assert all(e["energy_level"] == 1 for e in pre_wake)


def test_all_energy_levels_in_range():
    result = build_energy_defaults(wake_hour=7)
    assert all(1 <= e["energy_level"] <= 5 for e in result)


def test_late_wake_hour():
    # wake_hour=10 → peak window is 12,13,14
    result = build_energy_defaults(wake_hour=10)
    peak = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (12, 13, 14)]
    assert all(e["energy_level"] == 5 for e in peak)


def test_same_across_all_days():
    result = build_energy_defaults(wake_hour=7)
    day0 = {e["hour_of_day"]: e["energy_level"] for e in result if e["day_of_week"] == 0}
    day6 = {e["hour_of_day"]: e["energy_level"] for e in result if e["day_of_week"] == 6}
    assert day0 == day6

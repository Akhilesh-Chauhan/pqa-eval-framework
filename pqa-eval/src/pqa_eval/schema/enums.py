from enum import Enum


class QuestionType(str, Enum):
    STARRED = "STARRED"
    UNSTARRED = "UNSTARRED"
    SHORT_NOTICE = "SHORT_NOTICE"


class House(str, Enum):
    LOK_SABHA = "LOK_SABHA"
    RAJYA_SABHA = "RAJYA_SABHA"


class RetrievalMode(str, Enum):
    STATIC = "STATIC"
    LIVE = "LIVE"

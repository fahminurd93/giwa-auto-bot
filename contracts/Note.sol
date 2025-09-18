// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;contract Note{mapping(address=>string) private _note;event SetNote(address indexed user,string note);function setNote(string calldata note_) external{_note[msg.sender]=note_;emit SetNote(msg.sender,note_);}function noteOf(address user) external view returns(string memory){return _note[user];}}

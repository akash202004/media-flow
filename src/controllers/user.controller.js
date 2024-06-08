import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js"
import { ApiError } from "../utils/ApiError.js"
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken";
import fs from "fs"
import mongoose from "mongoose";

const generateAccessAndRefreshTokens = async (userID) => {
    try {
        const user = await User.findById(userID);

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })

        return { refreshToken, accessToken }

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating refresh and access tokens");
    }

}

const registerUser = asyncHandler(async (req, res) => {
    const { fullName, email, password, username } = req.body

    if (
        [fullName, email, password, username].some((fields) => fields?.trim() === "")
    ) {
        throw new ApiError(400, "All fields are required")
    }

    const existedUser = await User.findOne({
        $or: [{ email }, { username }]
    })

    if (existedUser) {
        throw new ApiError(409, "User with email or username already exists");
    }

    // const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    let avatarLocalPath;
    if (req.files && Array.isArray(req.files.avatar)) {
        avatarLocalPath = req.files.avatar[0].path;
    } else {
        throw new ApiError(400, "Avatar is required")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!avatar) throw new ApiError(400, "Avatar is required");

    const user = await User.create({
        username: username.toLowerCase(),
        email,
        fullName,
        avatar: {
            public_id: avatar.public_id,
            url: avatar.secure_url
        },
        coverImage: {
            public_id: coverImage?.public_id || "",
            url: coverImage?.secure_url || ""
        },
        password,
    })

    const createUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if (!createUser) throw new ApiError(500, "Something went wrong while registering the user");

    return res.status(201).json(
        new ApiResponse(200, createUser, "User register successfully")
    )
})

const loginUser = asyncHandler(async (req, res) => {

    const { email, password, username } = req.body

    if (!(username || email)) throw new ApiError(400, "Username or Email is Required")

    const user = await User.findOne({
        $or: [{ email }, { username }]
    })

    if (!user) throw new ApiError(404, "User not found");

    const isPasswordValid = await user.isPasswordCorrect(password);

    if (!isPasswordValid) throw new ApiError(401, "Password is Invalid");

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(
            200,
            {
                user: loggedInUser, refreshToken, accessToken
            },
            "User logged in successfully"
        ))
})

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1,
            }
        },
        {
            new: true
        }
    )
    const options = {
        httpOnly: true,
        secure: true
    }

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User Logged Out"))
})

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshtoken = req.cookies.refreshToken || req.body.refreshToken

    if (!incomingRefreshtoken) throw new ApiError(401, "Unauthorized request")

    try {
        const decodedToken = jwt.verify(incomingRefreshtoken, process.env.REFRESH_TOKEN_SECRET)

        const user = await User.findById(decodedToken?._id);

        if (!user) throw new ApiError(401, "Invalid refreh token");

        if (incomingRefreshtoken !== user?.refreshToken) throw new ApiError(401, "Refresh token is expierd or used");

        const options = {
            httpOnly: true,
            secure: true
        }

        const { accessToken, newRefreshToken } = await generateAccessAndRefreshTokens(user._id);

        return res
            .status(200)
            .cookie("refreshToken", newRefreshToken, options)
            .cookie("accessToken", accessToken, options)
            .json(new ApiResponse(
                200,
                { refreshToken: newRefreshToken, accessToken },
                "Access token refreshed"
            ))
    } catch (error) {
        throw new ApiError(401, error?.message || "Inavlid refresh token");
    }

})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body

    const user = await User.findById(req.user?._id);
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if (!isPasswordCorrect) throw new ApiError(400, "Invalid Old Password");

    user.password = newPassword;
    await user.save({ validateBeforeSave: false })

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Password Changed Successfully"))

})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullName, email } = req.body
    if (!(fullName || email)) throw new ApiError(400, "All Fields are is Required");

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                email: email,
                fullName: fullName
            }
        },
        { new: true }
    ).select("-password")

    return res
        .status(200)
        .json(new ApiResponse(200, user, "Account Details Updated Successfully"))
})

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(new ApiResponse(200, req.user, "User fetched successfully"))
})

const updateUserAvatar = asyncHandler(async (req, res) => {

    const avatarLocalPath = req.file?.path
    if (!avatarLocalPath) throw new ApiError(401, "Avatar Path is Missing");

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    if (!avatar?.url) throw new ApiError(401, "Error while uploading Avatar");

    const user = await User.findById(req.user?._id).select("avatar");
    const deleteOldAvatar = user.avatar.public_id;
    if (!deleteOldAvatar) throw new ApiError(400, "Old Avatar is Missing");

    const updateUser = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: {
                    public_id: avatar.public_id,
                    url: avatar.secure_url
                }
            }
        },
        { new: true }
    ).select("-password")

    if (updateUser.avatar !== avatar.url) {
        try {
            const oldAvatarFilename = updateUser.avatar.split('/').pop();
            const oldAvatarLocalPath = `upload/${oldAvatarFilename}`

            if (fs.existsSync(oldAvatarLocalPath)) {
                fs.unlinkSync(oldAvatarLocalPath)
            }
        } catch (error) {
            new ApiError(400, "Error while deleting the old Details")
        }
    }

    if (deleteOldAvatar) {
        try {
            await deleteFromCloudinary(deleteOldAvatar);
        } catch (error) {
            new ApiError(400, "Error while deleting the old Details in Cloudinary")
        }
    }

    return res
        .status(200)
        .json(new ApiResponse(200, updateUser, "Avatar Changed Succesfully"))
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path
    if (!coverImageLocalPath) throw new ApiError(401, "Cover Image Path is Missing");

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if (!coverImage?.url) throw new ApiError(401, "Error while uploading coverImage");

    const user = await User.findById(req.user?._id).select("coverImage");
    const deleteOldCoverImage = user.coverImage?.public_id;

    const updateUser = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: {
                    public_id: coverImage.public_id,
                    url: coverImage.secure_url
                }
            }
        },
        { new: true }
    ).select("-password")

    if (updateUser.coverImage !== coverImage.url) {
        try {
            const oldcoverImageFilename = updateUser.coverImage.split('/').pop();
            const oldcoverImageLocalPath = `upload/${oldcoverImageFilename}`

            if (fs.existsSync(oldcoverImageLocalPath)) {
                fs.unlinkSync(oldcoverImageLocalPath)
            }
        } catch (error) {
            new ApiError(400, "Error while deleting the old Details")
        }
    }

    if (deleteOldCoverImage) {
        try {
            await deleteFromCloudinary(deleteOldCoverImage);
        } catch (error) {
            new ApiError(400, "Error while deleting the old Details in Cloudinary")
        }
    }

    return res
        .status(200)
        .json(new ApiResponse(200, updateUser, "Cover Image Changed Succesfully"))
})

const getUserChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params
    if (!username) throw new ApiError(400, "Username is Missing");

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscriberdTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscriberdTo"
                },
                isSubscribed: {
                    $cond: {
                        if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullNmae: 1,
                username: 1,
                email: 1,
                avatar: 1,
                coverImage: 1,
                subscribersCount: 1,
                cahnnelsSubscribedToCount: 1,
                isSubscribed: 1
            }
        }
    ])
    if (!channel?.length) throw new ApiError(404, "Channel dose not exist");

    return res
        .status(200)
        .json(new ApiResponse(200, channel[0], "User Channel Fetched Successfully"))
})

const getWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    return res
        .status(200)
        .json(new ApiResponse(200, user[0].watchHistory, "Watch History Fetched Succesfully"))
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    updateAccountDetails,
    getCurrentUser,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
}